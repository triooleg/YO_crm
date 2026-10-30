import { BadRequestException } from "@nestjs/common";
import { websiteOrderCardFee } from "../orders/website-order-fee";
import { appliedPaymentMinor } from "./exchange-rates";
import { buildOrderDocumentSnapshot, type DocumentTemplateConfig } from "./order-document-model";

type Order = Parameters<typeof buildOrderDocumentSnapshot>[0];
export function invoiceTemplateSnapshot(order: Order, config: DocumentTemplateConfig, language: string) {
 const snapshot=buildOrderDocumentSnapshot(order,[...config.fieldKeys,"client.name","client.address","table.items","finance.total","finance.paid","finance.balance"]);
 const addresses=String(snapshot.values["client.address"]??"");
 const required=[...new Set(["seller.name","customer.name","order.items.name",...config.requiredFields])];
 const present:Record<string,boolean>={"seller.name":!!config.seller.name.trim(),"seller.address":!!config.seller.address.trim(),"customer.name":!!order.client.displayName.trim(),"customer.address":!!addresses.trim(),"order.items.name":!!order.items?.length&&!order.items.some(item=>!item.name.trim())};
 const errors:Record<string,string>={"seller.name":"Заполните имя продавца в настройках шаблона","seller.address":"Заполните адрес продавца в настройках шаблона","customer.name":"Заполните имя клиента в карточке клиента","customer.address":"Заполните адрес клиента в карточке клиента","order.items.name":"Добавьте позиции с названиями в заказ"};
 const missing=required.filter(key=>!present[key]);
 if(missing.length)throw new BadRequestException({message:missing.map(key=>errors[key]).join(". "),fields:missing});
 if (!/^[A-Z]{3}$/.test(order.currency)) throw new BadRequestException("Некорректная валюта заказа");
 if (config.currency && config.currency !== order.currency) throw new BadRequestException("Валюта шаблона не совпадает с валютой заказа");
 const financial=[order.priceMinor,order.deliveryMinor??0,order.giftWrapMinor??0,order.discountMinor??0,...(order.items??[]).flatMap(item=>[item.priceMinor,item.quantity])];
 if (financial.some(value=>!Number.isSafeInteger(value)) || order.priceMinor < 0 || order.priceMinor > 2147483647 || order.items?.some(item=>item.quantity<1||item.priceMinor<0)) throw new BadRequestException("Некорректная сумма или количество позиций заказа");
 const names:Record<string,string[]>={ru:["Доставка","Подарочная упаковка","Скидка","Корректировка согласованной стоимости"],uk:["Доставка","Подарункова упаковка","Знижка","Коригування погодженої вартості"],en:["Shipping","Gift wrap","Discount","Agreed price adjustment"],fr:["Livraison","Emballage cadeau","Remise","Ajustement du prix convenu"]};
 const labels=names[language]??names.en!;
 const add=(description:string,amountMinor:number)=>{if(amountMinor) snapshot.items.push({description,quantity:1,amountMinor,sku:"",designNumber:null,properties:[]})};
 add(config.labels.shipping??labels[0]!,order.deliveryMinor??0);add(config.labels.giftWrap??labels[1]!,order.giftWrapMinor??0);
 const websiteNet=order.sourceSystem==="YOLEOTARD_WEBSITE";
 if(!websiteNet)add(config.labels.discount??labels[2]!,-(order.discountMinor??0));
 const cardFee=websiteOrderCardFee({sourceSystem:order.sourceSystem??null,externalData:order.externalData,priceMinor:order.priceMinor});
 const feeNames:Record<string,string>={ru:"Комиссия за оплату картой",uk:"Комісія за оплату карткою",en:"Card payment fee",fr:"Frais de paiement par carte"};
 if(cardFee)add(config.labels.cardFee??feeNames[language]??feeNames.en!,cardFee);

 const lineTotal=snapshot.items.reduce((sum,item)=>sum+item.quantity*item.amountMinor,0);
 if(!Number.isSafeInteger(lineTotal))throw new BadRequestException("Сумма позиций превышает допустимое значение");
 add(config.labels.adjustment??labels[3]!,order.priceMinor-lineTotal);
 // Use the payment policy, including signed same-currency corrections. REFUNDED
 // status alone is not a refund ledger and never synthesizes a receipt.
 const paid=(order.payments??[]).reduce((sum,payment)=>sum+appliedPaymentMinor(payment,order.currency),0);
 if(!Number.isSafeInteger(paid))throw new BadRequestException("Некорректная сумма поступлений");
 snapshot.values["finance.total"]={minor:order.priceMinor,currency:order.currency};
 snapshot.values["finance.paid"]={minor:paid,currency:order.currency};
 snapshot.values["finance.balance"]={minor:order.priceMinor-paid,currency:order.currency};
 snapshot.payments=snapshot.payments.map((payment,index)=>({...payment,amountMinor:order.payments![index]!.amountMinor,appliedAmountMinor:order.payments![index]!.appliedAmountMinor??null}));
 return {...snapshot,fieldKeys:[...config.fieldKeys],discountIncludedInItems:websiteNet,immutableInvoice:true};
}
