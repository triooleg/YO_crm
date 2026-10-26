import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { OrderDocumentKind, Prisma, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CreateDocumentTemplateDto, CreateInvoiceDto, CreateOrderDocumentDto, PreviewOrderDocumentDto, UpdateDocumentTemplateDto, InvoicePreviewDto, InvoiceFromTemplateDto, ValidateDocumentTemplateDto, PreviewDocumentTemplateDto, TemplateRevisionDto, DocumentTemplateConfigDto } from "./finance.dto";
import { buildOrderDocumentSnapshot, builtInDocumentTemplates, mergeInvoiceItems, normalizeDocumentFieldKeys, normalizeDocumentKind, normalizeDocumentLanguage, normalizeTemplateConfig, orderDocumentFieldDefinitions, updateInvoiceSnapshot, type DocumentTemplateConfig, type DocumentTemplateView } from "./order-document-model";
import { invoiceTemplateSnapshot } from "./invoice-template-model";
import { invoiceDisplayNumber } from "./invoice-number";
import { resolveInvoiceBranding } from "./invoice-branding";
import { renderOrderDocumentPdf, renderSimplifiedInvoiceHtml } from "./order-document-pdf";

const orderDocumentInclude = {
  client: { select: { displayName: true, email: true, phone: true, country: true, city: true, address: true, postalCode: true, language: true } },
  athlete: { select: { firstName: true, lastName: true } },
  items: { where: { archivedAt: null }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: { name: true, quantity: true, priceMinor: true, sku: true, designNumber: true, properties: true } },
  payments: { where: { voidedAt: null }, orderBy: [{ receivedAt: "asc" as const }, { id: "asc" as const }], select: { amountMinor: true, currency: true, appliedAmountMinor: true, appliedCurrency: true, receivedAt: true, method: true, reference: true } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrderDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async templates(): Promise<DocumentTemplateView[]> {
    const custom = await this.prisma.documentTemplate.findMany({ where: { archivedAt: null }, orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }] });
    return [...builtInDocumentTemplates().map(item=>templateView(item)), ...custom.map(item => templateView({ ...item, kind: normalizeDocumentKind(item.kind), language: normalizeDocumentLanguage(item.language), builtIn: false, config: normalizeTemplateConfig(item.config, item.language) }))].sort((a,b)=>Number(b.isDefault)-Number(a.isDefault));
  }

  validateTemplate(dto: ValidateDocumentTemplateDto) {
    const raw=dto.config;
    const allowed=["version","title","fieldKeys","showLogo","seller","payment","currency","purpose","isDefault","revision","editableMetadata","notes","appearance","labels","footer","requiredFields"];
    const unknown=Object.keys(raw).filter(key=>!allowed.includes(key));
    const knownFields=new Set(orderDocumentFieldDefinitions().map(field=>field.key));
    const badFields=(raw.fieldKeys??[]).filter(key=>!knownFields.has(key));
    if(unknown.length||badFields.length)throw new BadRequestException("Неизвестные поля шаблона: "+[...unknown,...badFields].join(", "));
    const labelKeys=["seller","billTo","date","due","product","qty","unit","amount","payment","receiver","iban","bic","instructions","payments","number","order","notes","shipping","giftWrap","discount","discountIncluded","cardFee","adjustment",...knownFields];
    if(raw.labels&&Object.keys(raw.labels).some(key=>!labelKeys.includes(key)))throw new BadRequestException("Неизвестные подписи шаблона: "+Object.keys(raw.labels).filter(key=>!labelKeys.includes(key)).join(", "));

    // Global legacy whitelist intentionally allows the opaque config object;
    // validate it here before unknown keys can be silently stripped.
    const errors=validateSync(plainToInstance(DocumentTemplateConfigDto,raw),{whitelist:true,forbidNonWhitelisted:true});
    if(errors.length)throw new BadRequestException("Некорректная настройка шаблона: "+errors.map(error=>error.property).join(", "));
    if(raw.currency!=null && !["EUR","USD","UAH"].includes(raw.currency))throw new BadRequestException("Некорректная валюта шаблона");
    if(raw.appearance && [raw.appearance.accentColor,raw.appearance.mutedColor].some(value=>value!==undefined&&!/^#[0-9a-f]{6}$/i.test(value)))throw new BadRequestException("Цвет должен иметь формат #RRGGBB");
    if(raw.labels && (Object.keys(raw.labels).length>100||Object.values(raw.labels).some(value=>typeof value!=="string"||value.length>160)))throw new BadRequestException("Некорректные подписи документа");
    const config=normalizeTemplateConfig(raw,dto.language);
    if(!config.fieldKeys.length)throw new BadRequestException("Выберите хотя бы одно поле документа");
    return config;
  }

  private async templatePreviewSource(dto:PreviewDocumentTemplateDto) {
    const config=this.validateTemplate(dto),order=await this.order(dto.orderId);
    const dataSnapshot=dto.kind&&dto.kind!=="INVOICE"?buildOrderDocumentSnapshot(order,config.fieldKeys):invoiceTemplateSnapshot(order,config,dto.language);
    const branding=config.showLogo&&(!dto.kind||dto.kind==="INVOICE")?await resolveInvoiceBranding(this.prisma):{};
    return {title:config.title,language:dto.language,templateSnapshot:config,dataSnapshot,issueDate:new Date(),number:order.number,...branding};
  }

  async previewTemplate(dto: PreviewDocumentTemplateDto) {
    return renderOrderDocumentPdf(await this.templatePreviewSource(dto));
  }

  async previewTemplateHtml(dto:PreviewDocumentTemplateDto) {
    return {html:renderSimplifiedInvoiceHtml(await this.templatePreviewSource(dto))};
  }

  async createTemplate(dto: CreateDocumentTemplateDto, user: User) {
    const config={...this.validateTemplate(dto),revision:1};
    return this.prisma.$transaction(async tx => {
      await this.lockTemplates(tx);
      if(config.isDefault)await this.clearDefaultTemplates(tx,user,dto.kind,config.currency);
      const created = await tx.documentTemplate.create({ data: { name: dto.name.trim(), kind: dto.kind, language: normalizeDocumentLanguage(dto.language), config: config as unknown as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "CREATE", entityType: "DocumentTemplate", entityId: created.id, after: created as unknown as Prisma.InputJsonValue } });
      return templateView({...created,builtIn:false,kind:normalizeDocumentKind(created.kind),language:normalizeDocumentLanguage(created.language),config});
    });
  }

  async updateTemplate(id: string, dto: UpdateDocumentTemplateDto, user: User) {
    return this.prisma.$transaction(async tx => {
      await this.lockTemplates(tx);
      const before = await tx.documentTemplate.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundException("Шаблон документа не найден; встроенный шаблон можно скопировать");
      const previous=normalizeTemplateConfig(before.config,before.language);
      if(dto.expectedRevision!==undefined && dto.expectedRevision!==previous.revision)throw new ConflictException("Шаблон уже изменён; обновите его перед сохранением");
      const language=normalizeDocumentLanguage(dto.language??before.language);
      const config={...(dto.config?this.validateTemplate({config:dto.config,language}):previous),revision:previous.revision+1};
      if(dto.active===false)config.isDefault=false;
      if(config.isDefault && !(dto.active??before.active))throw new BadRequestException("Шаблон по умолчанию должен быть активен");
      if(config.isDefault)await this.clearDefaultTemplates(tx,user,before.kind,config.currency,id);
      const updated = await tx.documentTemplate.update({ where: { id }, data: { name: dto.name?.trim(), active: dto.active, language, config: config as unknown as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "UPDATE", entityType: "DocumentTemplate", entityId: id, before: before as unknown as Prisma.InputJsonValue, after: updated as unknown as Prisma.InputJsonValue } });
      return templateView({...updated,builtIn:false,kind:normalizeDocumentKind(updated.kind),language,config});
    });
  }

  async templateAction(id:string,dto:TemplateRevisionDto,user:User,archive=false) {
    return this.prisma.$transaction(async tx=>{
      await this.lockTemplates(tx);
      const before=await tx.documentTemplate.findFirst({where:{id,archivedAt:null}});
      if(!before)throw new NotFoundException("Встроенный шаблон сначала нужно скопировать");
      const previous=normalizeTemplateConfig(before.config,before.language);
      if(dto.expectedRevision!==undefined&&dto.expectedRevision!==previous.revision)throw new ConflictException("Шаблон уже изменён");
      if(!archive&&!before.active)throw new BadRequestException("Выберите активный шаблон");
      if(!archive)await this.clearDefaultTemplates(tx,user,before.kind,previous.currency,id);
      const config={...previous,isDefault:!archive,revision:previous.revision+1};
      const after=await tx.documentTemplate.update({where:{id},data:{config:config as unknown as Prisma.InputJsonValue,...(archive?{active:false,archivedAt:new Date()}:{})}});
      await tx.auditLog.create({data:{actorId:user.id,action:archive?"ARCHIVE":"UPDATE",entityType:"DocumentTemplate",entityId:id,before:before as unknown as Prisma.InputJsonValue,after:after as unknown as Prisma.InputJsonValue}});
      return templateView({...after,builtIn:false,kind:normalizeDocumentKind(after.kind),language:normalizeDocumentLanguage(after.language),config});
    });
  }

  private lockTemplates(tx:Prisma.TransactionClient){return tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))","invoice-templates");}
  private async clearDefaultTemplates(tx:Prisma.TransactionClient,user:User,kind:string,currency:string|null,except?:string) {
    const templates=await tx.documentTemplate.findMany({where:{archivedAt:null}});
    for(const item of templates) {
      const config=normalizeTemplateConfig(item.config,item.language);
      if(item.id===except||!config.isDefault||item.kind!==kind||config.currency!==currency)continue;
      const after=await tx.documentTemplate.update({where:{id:item.id},data:{config:{...config,isDefault:false,revision:config.revision+1} as unknown as Prisma.InputJsonValue}});
      await tx.auditLog.create({data:{actorId:user.id,action:"UPDATE",entityType:"DocumentTemplate",entityId:item.id,before:item as unknown as Prisma.InputJsonValue,after:after as unknown as Prisma.InputJsonValue}});
    }
  }

  async invoicePreview(dto:InvoicePreviewDto,user:User) {
    await this.cleanupExpiredPreviews();
    const [order,template]=await Promise.all([this.order(dto.orderId),this.resolveTemplate(dto.templateKey)]);
    if(template.kind!=="INVOICE")throw new BadRequestException("Выберите шаблон инвойса");
    if(dto.sourceInvoiceId) {
      const source=await this.prisma.invoice.findFirst({where:{id:dto.sourceInvoiceId,orderId:order.id}});
      if(!source)throw new NotFoundException("Исходный инвойс этого заказа не найден");
    }
    let config=template.config;
    if(template.builtIn) {
      const settings=await this.prisma.appSetting.findMany({where:{section:"finance",key:{in:["sellerName","sellerAddress"]}}});
      const value=(key:string)=>{const item=settings.find(item=>item.key===key);return typeof item?.value==="string"?item.value.trim():""};
      config={...config,seller:{name:value("sellerName"),address:value("sellerAddress")}};
    }
    const metadata=dto.metadata??{};
    for(const key of Object.keys(metadata))if(!config.editableMetadata.includes(key))throw new BadRequestException("Шаблон запрещает изменение поля "+key);
    if(metadata.showLogo!==undefined)config={...config,showLogo:metadata.showLogo};
    const issueDate=metadata.issueDate?new Date(metadata.issueDate):new Date(),dueDate=metadata.dueDate?new Date(metadata.dueDate):null;
    if(Number.isNaN(issueDate.getTime())||(dueDate&&(Number.isNaN(dueDate.getTime())||dueDate<issueDate)))throw new BadRequestException("Некорректная дата инвойса");
    const dataSnapshot=invoiceTemplateSnapshot(order,config,template.language);
    const prefixSetting=await this.prisma.appSetting.findUnique({where:{section_key:{section:"finance",key:"invoicePrefix"}}});
    const prefix=(typeof prefixSetting?.value==="string"?prefixSetting.value:"INV-YO").toUpperCase().replace(/[^A-Z0-9-]/g,"").replace(/-+$/g,"")||"INV-YO";
    // No Invoice or numbering reservation is created by preview. A UUID namespace
    // avoids cross-worker allocation races; Invoice.number remains UNIQUE in SQL.
    const number=`${prefix}-${issueDate.getUTCFullYear()}-${randomUUID().replace(/-/g,"").slice(0,12).toUpperCase()}`;
    const invoice={number,orderId:order.id,language:template.language,currency:order.currency,issueDate:issueDate.toISOString(),dueDate:dueDate?.toISOString()??null,seller:config.seller,customer:{name:order.client.displayName,address:String(dataSnapshot.values["client.address"]||"")},items:dataSnapshot.items,notes:metadata.notes??null,totalMinor:order.priceMinor,templateKey:template.id,templateSnapshot:config,dataSnapshot:{...dataSnapshot,sourceInvoiceId:dto.sourceInvoiceId??null},documentOptions:{title:config.title,immutable:true,numberSource:"ORDER",displayNumber:order.number,templateName:template.name,templateRevision:config.revision,sourceInvoiceId:dto.sourceInvoiceId??null}};
    const branding=config.showLogo?await resolveInvoiceBranding(this.prisma):{};
    const source={...invoice,number:invoiceDisplayNumber(invoice),title:config.title,issueDate,dueDate,...branding};
    const pdf=await this.renderInvoiceSnapshot(source),html=renderSimplifiedInvoiceHtml(source);
    const token=randomUUID(),expiresAt=new Date(Date.now()+30*60*1000).toISOString();
    await this.prisma.appSetting.create({data:{section:"invoice-previews",key:token,value:{actorId:user.id,expiresAt,invoice,html,pdfBase64:pdf.toString("base64"),invoiceId:null} as unknown as Prisma.InputJsonValue}});
    return {previewToken:token,html,number:invoiceDisplayNumber(invoice),language:invoice.language,currency:invoice.currency,totalMinor:invoice.totalMinor,templateName:template.name,templateRevision:config.revision,issueDate:invoice.issueDate,dueDate:invoice.dueDate,expiresAt,documentUrl:`/finance/invoice-previews/${token}/document`,sourceInvoiceId:dto.sourceInvoiceId??null};
  }

  private async cleanupExpiredPreviews() {
    // Bounded work, serialized with save. Only expired, never-saved preview rows
    // can disappear; artifacts, issued documents and retry receipts are retained.
    await this.prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))","invoice-idempotency");
      const expired=await tx.appSetting.findMany({where:{section:"invoice-previews",AND:[{value:{path:["expiresAt"],lt:new Date().toISOString()}},{value:{path:["invoiceId"],equals:Prisma.JsonNull}}]},orderBy:{updatedAt:"asc"},take:100});
      const keys=expired.filter(row=>!(row.value as unknown as StoredInvoicePreview).invoiceId).map(row=>row.key);
      if(keys.length)await tx.appSetting.deleteMany({where:{section:"invoice-previews",key:{in:keys}}});
    });
  }

  private async storedPreview(token:string,user:User,tx:Prisma.TransactionClient=this.prisma) {
    const setting=await tx.appSetting.findUnique({where:{section_key:{section:"invoice-previews",key:token}}});
    const value=setting?.value as unknown as StoredInvoicePreview|null;
    if(!value||value.actorId!==user.id)throw new NotFoundException("Предпросмотр не найден");
    return value;
  }

  async invoicePreviewDocument(token:string,user:User) {
    const preview=await this.storedPreview(token,user);
    if(Date.parse(preview.expiresAt)<=Date.now())throw new BadRequestException("Предпросмотр истёк; создайте новый");
    await this.order(preview.invoice.orderId);
    return {number:invoiceDisplayNumber(preview.invoice),pdf:Buffer.from(preview.pdfBase64,"base64")};
  }

  async invoiceFromTemplate(dto:InvoiceFromTemplateDto,user:User) {
    const original=await this.storedPreview(dto.previewToken,user);
    return this.prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",original.invoice.orderId);
      await this.lockTemplates(tx);
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))","invoice-idempotency");
      const preview=await this.storedPreview(dto.previewToken,user,tx);
      const key=createHash("sha256").update(user.id+":"+dto.idempotencyKey).digest("hex");
      const replay=await tx.appSetting.findUnique({where:{section_key:{section:"invoice-idempotency",key}}});
      if(replay) {
        const saved=replay.value as {previewToken:string;invoiceId:string};
        if(saved.previewToken!==dto.previewToken)throw new ConflictException("Ключ уже использован для другого предпросмотра");
        return this.savedInvoice(tx,saved.invoiceId);
      }
      if(preview.invoiceId){
        await tx.appSetting.create({data:{section:"invoice-idempotency",key,value:{previewToken:dto.previewToken,invoiceId:preview.invoiceId}}});
        return this.savedInvoice(tx,preview.invoiceId);
      }
      if(Date.parse(preview.expiresAt)<=Date.now())throw new BadRequestException("Предпросмотр истёк; создайте новый");
      const frozen=preview.invoice;
      const order=await tx.order.findFirst({where:{id:frozen.orderId,archivedAt:null},select:{id:true,clientId:true}});
      if(!order)throw new NotFoundException("Заказ не найден");
      if(!builtInDocumentTemplates().some(item=>item.id===frozen.templateKey)) {
        const template=await tx.documentTemplate.findFirst({where:{id:frozen.templateKey,active:true,archivedAt:null}});
        if(!template)throw new BadRequestException("Шаблон больше не активен; выберите другой");
      }
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('yoleotard-invoice-number'))");
      if(await tx.invoice.findUnique({where:{number:frozen.number}}))throw new ConflictException("Номер инвойса уже занят; создайте новый предпросмотр");
      const invoice=await tx.invoice.create({data:{...frozen,status:"ISSUED",issueDate:new Date(frozen.issueDate),dueDate:frozen.dueDate?new Date(frozen.dueDate):null,documentOptions:frozen.documentOptions} as unknown as Prisma.InvoiceUncheckedCreateInput});
      await tx.appSetting.create({data:{section:"invoice-documents",key:invoice.id,value:{pdfBase64:preview.pdfBase64,html:preview.html}}});
      await tx.appSetting.update({where:{section_key:{section:"invoice-previews",key:dto.previewToken}},data:{value:{...preview,invoiceId:invoice.id} as unknown as Prisma.InputJsonValue}});
      await tx.appSetting.create({data:{section:"invoice-idempotency",key,value:{previewToken:dto.previewToken,invoiceId:invoice.id}}});
      await tx.activity.create({data:{clientId:order.clientId,orderId:order.id,type:"INVOICE_CREATED",summary:"Создан инвойс "+invoiceDisplayNumber(invoice),metadata:{invoiceId:invoice.id,sourceInvoiceId:frozen.documentOptions.sourceInvoiceId,templateKey:frozen.templateKey}}});
      await tx.auditLog.create({data:{actorId:user.id,action:"CREATE",entityType:"Invoice",entityId:invoice.id,after:{number:invoice.number,orderId:order.id,templateKey:frozen.templateKey,templateRevision:frozen.documentOptions.templateRevision,sourceInvoiceId:frozen.documentOptions.sourceInvoiceId}}});
      return publicInvoice(invoice);
    },{timeout:20000});
  }

  private async savedInvoice(tx:Prisma.TransactionClient,id:string) {
    const invoice=await tx.invoice.findUnique({where:{id}});
    if(!invoice)throw new NotFoundException("Сохранённый инвойс не найден");
    return publicInvoice(invoice);
  }

  async invoiceHtml(id:string) {
    const invoice=await this.prisma.invoice.findUnique({where:{id}});
    if(!invoice)throw new NotFoundException("Инвойс не найден");
    const options=invoice.documentOptions as Record<string,unknown>|null;
    if(options?.immutable!==true)return {html:null};
    const artifact=await this.prisma.appSetting.findUnique({where:{section_key:{section:"invoice-documents",key:id}}});
    const value=artifact?.value as {html?:string}|undefined;
    return {html:typeof value?.html==="string"?value.html:null};
  }

  async archiveInvoice(id:string,user:User) {
    return this.prisma.$transaction(async tx=>{
      const target=await tx.invoice.findUnique({where:{id}});
      if(!target)throw new NotFoundException("Инвойс не найден");
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))",target.orderId);
      const before=await tx.invoice.findUnique({where:{id}});
      if(!before)throw new NotFoundException("Инвойс не найден");
      if(before.archivedAt)return publicInvoice(before);
      const order=await tx.order.findFirst({where:{id:before.orderId,archivedAt:null},select:{clientId:true}});
      if(!order)throw new NotFoundException("Заказ не найден");
      const after=await tx.invoice.update({where:{id},data:{archivedAt:new Date()}});
      await tx.activity.create({data:{clientId:order.clientId,orderId:before.orderId,type:"INVOICE_ARCHIVED",summary:"Архивирован инвойс "+invoiceDisplayNumber(before),metadata:{invoiceId:id}}});
      await tx.auditLog.create({data:{actorId:user.id,action:"ARCHIVE",entityType:"Invoice",entityId:id,before:{archivedAt:null},after:{archivedAt:after.archivedAt?.toISOString()??null}}});
      return publicInvoice(after);
    });
  }

  async fields(orderId: string) {
    const order = await this.order(orderId);
    const allKeys = orderDocumentFieldDefinitions().map(item => item.key), snapshot = buildOrderDocumentSnapshot(order, allKeys);
    return { definitions: orderDocumentFieldDefinitions(), snapshot };
  }

  fieldDefinitions() { return orderDocumentFieldDefinitions(); }

  async preview(dto: PreviewOrderDocumentDto) {
    const prepared = await this.prepare(dto);
    const dataSnapshot = withDocumentMetadata(dto.items?.length ? mergeInvoiceItems(prepared.dataSnapshot, dto.items) : prepared.dataSnapshot, dto);
    return renderOrderDocumentPdf({ title: dto.title || prepared.template.config.title, language: dto.language || prepared.template.language, templateSnapshot: prepared.template.config, dataSnapshot, issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined, dueDate: dto.dueDate ? new Date(dto.dueDate) : null, notes: dto.notes, number: dataSnapshot.orderNumber });
  }

  async create(dto: CreateOrderDocumentDto, user: User) {
    const prepared = await this.prepare(dto);
    if (prepared.template.kind === "INVOICE") throw new BadRequestException("Инвойс создаётся через форму инвойса");
    const title = dto.title?.trim() || prepared.template.config.title;
    const dataSnapshot = withDocumentMetadata(prepared.dataSnapshot, dto);
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", prepared.order.id);
      const activeOrder = await tx.order.findFirst({ where: { id: prepared.order.id, archivedAt: null }, select: { id: true, clientId: true } });
      if (!activeOrder) throw new NotFoundException("Заказ не найден");
      if (!prepared.template.builtIn) {
        const activeTemplate = await tx.documentTemplate.findFirst({ where: { id: prepared.template.id, active: true, archivedAt: null }, select: { id: true } });
        if (!activeTemplate) throw new NotFoundException("Активный шаблон документа не найден");
      }
      const document = await tx.orderDocument.create({ data: { orderId: prepared.order.id, templateKey: prepared.template.id, kind: prepared.template.kind as OrderDocumentKind, title, language: dto.language || prepared.template.language, templateSnapshot: prepared.template.config as unknown as Prisma.InputJsonValue, dataSnapshot: dataSnapshot as unknown as Prisma.InputJsonValue } });
      await tx.activity.create({ data: { clientId: activeOrder.clientId, orderId: activeOrder.id, type: "ORDER_DOCUMENT_CREATED", summary: `Создан документ «${title}»`, metadata: { documentId: document.id, kind: document.kind } } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "CREATE", entityType: "OrderDocument", entityId: document.id, after: document as unknown as Prisma.InputJsonValue } });
      return document;
    });
  }

  async document(id: string) {
    const document = await this.prisma.orderDocument.findFirst({ where: { id, archivedAt: null } });
    if (!document) throw new NotFoundException("Документ заказа не найден");
    const metadata = documentSnapshotMetadata(document.dataSnapshot);
    return { title: document.title, pdf: await renderOrderDocumentPdf({ title: document.title, language: document.language, templateSnapshot: document.templateSnapshot, dataSnapshot: document.dataSnapshot, issueDate: metadata.issueDate, dueDate: metadata.dueDate, notes: metadata.notes }) };
  }

  async prepareInvoice(dto: CreateInvoiceDto) {
    const prepared = await this.prepare({ ...dto, templateKey: dto.templateKey || "builtin-invoice-en-sepa", fieldKeys: dto.fieldKeys, title: dto.documentTitle, seller: dto.seller, notes: dto.notes });
    const dataSnapshot = updateInvoiceSnapshot(mergeInvoiceItems(prepared.dataSnapshot, dto.items), undefined, dto.customer)!;
    return { templateKey: prepared.template.id, templateSnapshot: { ...prepared.template.config, showLogo: dto.showLogo ?? prepared.template.config.showLogo }, dataSnapshot, documentOptions: { title: dto.documentTitle || prepared.template.config.title, fieldKeys: dataSnapshot.fieldKeys } };
  }

  async renderInvoiceSnapshot(invoice: { number: string; language: string; issueDate: Date; dueDate: Date | null; notes: string | null; currency: string; templateSnapshot: unknown; dataSnapshot: unknown; documentOptions: unknown; logoDataUri?: string }) {
    const options = invoice.documentOptions && typeof invoice.documentOptions === "object" ? invoice.documentOptions as Record<string, unknown> : {};
    return renderOrderDocumentPdf({ title: String(options.title || "INVOICE"), language: invoice.language, templateSnapshot: invoice.templateSnapshot, dataSnapshot: invoice.dataSnapshot, number: invoiceDisplayNumber(invoice), issueDate: invoice.issueDate, dueDate: invoice.dueDate, notes: invoice.notes, currency: invoice.currency, logoDataUri:invoice.logoDataUri });
  }

  updateInvoiceSnapshots(invoice: { templateSnapshot: unknown; dataSnapshot: unknown }, dto: { seller?: { name: string; address?: string }; customer?: { name: string; address?: string }; items?: Array<{ description: string; quantity: number; amountMinor: number }> }) {
    const dataSnapshot = updateInvoiceSnapshot(invoice.dataSnapshot, dto.items, dto.customer);
    const templateSnapshot = invoice.templateSnapshot && typeof invoice.templateSnapshot === "object"
      ? normalizeTemplateConfig({ ...(invoice.templateSnapshot as Record<string, unknown>), seller: dto.seller ?? (invoice.templateSnapshot as Record<string, unknown>).seller })
      : undefined;
    return { dataSnapshot, templateSnapshot };
  }

  private async prepare(dto: CreateOrderDocumentDto | PreviewOrderDocumentDto | (CreateInvoiceDto & { templateKey: string })) {
    const [order, template] = await Promise.all([this.order(dto.orderId), this.resolveTemplate(dto.templateKey)]);
    const fieldKeys = normalizeDocumentFieldKeys(dto.fieldKeys?.length ? dto.fieldKeys : template.config.fieldKeys);
    if (!fieldKeys.length) throw new BadRequestException("Выберите хотя бы одно поле документа");
    const requestedTitle = "title" in dto ? dto.title : dto.documentTitle;
    // Payment details are controlled only through admin-managed templates. Per-document
    // payloads cannot replace bank details, including through the preview endpoint.
    const override = { ...template.config, title: requestedTitle?.trim() || template.config.title, fieldKeys, seller: { ...template.config.seller, ...(dto.seller || {}) }, payment: template.config.payment };
    const normalizedConfig = normalizeTemplateConfig({ ...override, showLogo: dto.showLogo ?? override.showLogo }, dto.language || template.language);
    const snapshot = buildOrderDocumentSnapshot(order, fieldKeys);
    const dataSnapshot = dto.customer ? updateInvoiceSnapshot(snapshot, undefined, dto.customer)! : snapshot;
    return { order, template: { ...template, language: normalizeDocumentLanguage(dto.language || template.language), config: normalizedConfig }, dataSnapshot };
  }

  private async resolveTemplate(key: string) {
    const builtIn = builtInDocumentTemplates().find(item => item.id === key);
    if (builtIn) return builtIn;
    const item = await this.prisma.documentTemplate.findFirst({ where: { id: key, archivedAt: null, active: true } });
    if (!item) throw new NotFoundException("Активный шаблон документа не найден");
    return { id: item.id, name: item.name, kind: normalizeDocumentKind(item.kind), language: normalizeDocumentLanguage(item.language), active: item.active, builtIn: false, config: normalizeTemplateConfig(item.config, item.language) } as DocumentTemplateView;
  }

  private async order(orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, archivedAt: null }, include: orderDocumentInclude });
    if (!order) throw new NotFoundException("Заказ не найден");
    return order;
  }
}

function withDocumentMetadata<T extends Record<string, unknown>>(snapshot: T, dto: { issueDate?: string; dueDate?: string; notes?: string }) {
  return { ...snapshot, documentMetadata: { issueDate: dto.issueDate || null, dueDate: dto.dueDate || null, notes: dto.notes || null } };
}

function documentSnapshotMetadata(snapshot: unknown) {
  const source = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {}, raw = source.documentMetadata && typeof source.documentMetadata === "object" ? source.documentMetadata as Record<string, unknown> : {};
  const parsed = (value: unknown) => { if (typeof value !== "string") return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date; };
  return { issueDate: parsed(raw.issueDate), dueDate: parsed(raw.dueDate) ?? null, notes: typeof raw.notes === "string" ? raw.notes : null };
}

function templateView<T extends DocumentTemplateView>(item:T) {
 return {...item,currency:item.config.currency,purpose:item.config.purpose,isDefault:item.config.isDefault,revision:item.config.revision,updatedAt:item.updatedAt??null};
}
function publicInvoice<T extends {number:string;documentOptions:unknown}>(invoice:T) {
 const options=invoice.documentOptions&&typeof invoice.documentOptions==="object"?invoice.documentOptions as Record<string,unknown>:{};
 const {pdfBase64: _pdf,...metadata}=options;
 return {...invoice,number:invoiceDisplayNumber(invoice),documentOptions:metadata};
}
type FrozenInvoice = {
 number:string;orderId:string;language:string;currency:string;issueDate:string;dueDate:string|null;
 seller:unknown;customer:unknown;items:unknown;notes:string|null;totalMinor:number;templateKey:string;
 templateSnapshot:unknown;dataSnapshot:unknown;
 documentOptions:{title:string;immutable:boolean;numberSource?:string;displayNumber?:string;templateName:string;templateRevision:number;sourceInvoiceId:string|null};
};
type StoredInvoicePreview={actorId:string;expiresAt:string;invoice:FrozenInvoice;html:string;pdfBase64:string;invoiceId:string|null};
