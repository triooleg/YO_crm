import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { uploadsRoot } from "../uploads";
import { CreateTaskColumnDto, CreateTaskDto, MoveTaskDto, UpdateTaskColumnDto, UpdateTaskDto, UploadTaskImageDto } from "./tasks.dto";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const OPTIMIZE_FROM_BYTES = 2 * 1024 * 1024;
const IMAGE_NAME = /^[a-f0-9-]+\.(jpg|png|webp)$/;
const defaultColumns = [
  { id: "task-column-new", name: "Новые", color: "#7047eb", sortOrder: 0, isDone: false },
  { id: "task-column-doing", name: "В работе", color: "#e49a34", sortOrder: 1, isDone: false },
  { id: "task-column-waiting", name: "Ожидают", color: "#5878c7", sortOrder: 2, isDone: false },
  { id: "task-column-done", name: "Готово", color: "#3b8f65", sortOrder: 3, isDone: true },
];

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureColumns() {
    await this.prisma.taskColumn.createMany({ data: defaultColumns, skipDuplicates: true });
  }

  async board(archived = false) {
    await this.ensureColumns();
    const [columns, users] = await Promise.all([
      this.prisma.taskColumn.findMany({
        where: archived
          ? { tasks: { some: { archivedAt: { not: null } } } }
          : { archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { tasks: { where: { archivedAt: archived ? { not: null } : null }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], include: {
          client: { select: { id: true, displayName: true, source: true, preferredChannel: true } },
          assignee: { select: { id: true, displayName: true, role: true } },
          attachments: { orderBy: { createdAt: "asc" } },
          sourceMessage: { select: { id: true, content: true, conversation: { select: { channel: true } } } },
        } } },
      }),
      this.prisma.user.findMany({ where: { active: true, archivedAt: null }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, role: true } }),
    ]);
    return { columns, users };
  }

  async incoming() {
    const messages = await this.prisma.message.findMany({
      where: { direction: "INBOUND", conversation: { archivedAt: null, client: { archivedAt: null } } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, content: true, createdAt: true, conversation: { select: { channel: true, client: { select: { id: true, displayName: true } } } }, workTasks: { where: { archivedAt: null }, select: { id: true } } },
    });
    return messages.map((message) => ({ ...message, taskCreated: message.workTasks.length > 0, workTasks: undefined }));
  }

  private async attachmentData(paths: string[] = []) {
    const unique = [...new Set(paths)];
    return Promise.all(unique.map(async (path) => {
      if (!IMAGE_NAME.test(path)) throw new BadRequestException("Некорректное имя изображения задачи");
      const file = await stat(join(uploadsRoot(), "task-images", path)).catch(() => null);
      if (!file?.isFile()) throw new BadRequestException("Изображение задачи не найдено");
      const extension = path.split(".").pop();
      return { path, mimeType: extension === "jpg" ? "image/jpeg" : `image/${extension}`, sizeBytes: file.size };
    }));
  }

  async uploadImage(dto: UploadTaskImageDto) {
    const sourceExt = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[dto.mime];
    if (!sourceExt) throw new BadRequestException("Допустимы JPG, PNG или WebP");
    const source = Buffer.from(dto.data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!source.length || source.length > MAX_SOURCE_BYTES) throw new BadRequestException("Размер изображения должен быть до 5 МБ");
    const metadata = await sharp(source).metadata().catch(() => null);
    if (!metadata || !["jpeg", "png", "webp"].includes(metadata.format || "")) throw new BadRequestException("Файл не является допустимым изображением");
    const actualExtension = metadata.format === "jpeg" ? "jpg" : metadata.format!;
    if (actualExtension !== sourceExt) throw new BadRequestException("Формат изображения не соответствует типу файла");
    let stored = source, extension = actualExtension, optimized = false;
    if (source.length > OPTIMIZE_FROM_BYTES) {
      try {
        stored = await sharp(source).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
        extension = "jpg"; optimized = true;
      } catch { throw new BadRequestException("Не удалось обработать изображение"); }
    }
    const dir = join(uploadsRoot(), "task-images"); await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${extension}`; await writeFile(join(dir, name), stored);
    return { path: name, url: `/api/tasks/images/${name}`, optimized, originalBytes: source.length, storedBytes: stored.length };
  }

  async create(dto: CreateTaskDto, actor: User) {
    const attachments = await this.attachmentData(dto.attachmentPaths);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('tasks-kanban'))");
      const column = await tx.taskColumn.findFirst({ where: { id: dto.columnId, archivedAt: null } });
      if (!column) throw new NotFoundException("Колонка задач не найдена");
      const assigneeId = dto.assigneeId || actor.id;
      const assignee = await tx.user.findFirst({ where: { id: assigneeId, active: true, archivedAt: null } });
      if (!assignee) throw new BadRequestException("Исполнитель задачи недоступен");
      let clientId = dto.clientId || null;
      if (dto.sourceMessageId) {
        const message = await tx.message.findFirst({ where: { id: dto.sourceMessageId, direction: "INBOUND", conversation: { archivedAt: null } }, select: { conversation: { select: { clientId: true } } } });
        if (!message) throw new BadRequestException("Входящее сообщение не найдено");
        if (clientId && clientId !== message.conversation.clientId) throw new BadRequestException("Сообщение принадлежит другому клиенту");
        clientId = message.conversation.clientId;
      }
      if (clientId && !await tx.client.findFirst({ where: { id: clientId, archivedAt: null }, select: { id: true } })) throw new BadRequestException("Клиент задачи не найден");
      const position = await tx.workTask.count({ where: { columnId: dto.columnId, archivedAt: null } });
      const task = await tx.workTask.create({ data: {
        columnId: dto.columnId, clientId, sourceMessageId: dto.sourceMessageId, assigneeId, createdById: actor.id,
        type: dto.type, title: dto.title.trim(), description: dto.description?.trim() || null, markerColor: dto.markerColor,
        labels: dto.labels?.map((label) => label.trim()).filter(Boolean) ?? [], dueAt: dto.dueAt ? new Date(dto.dueAt) : null, position,
        attachments: attachments.length ? { create: attachments } : undefined,
      }, include: { attachments: true } });
      if (clientId) await tx.activity.create({ data: { clientId, type: "TASK_CREATED", summary: `Создана задача: ${task.title}`, metadata: { taskId: task.id, sourceMessageId: dto.sourceMessageId } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "WorkTask", entityId: task.id, after: task } });
      return task;
    });
  }

  async update(id: string, dto: UpdateTaskDto, actor: User) {
    const attachments = await this.attachmentData(dto.attachmentPaths);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.workTask.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundException("Задача не найдена");
      if (dto.assigneeId !== undefined && dto.assigneeId !== null && !await tx.user.findFirst({ where: { id: dto.assigneeId, active: true, archivedAt: null }, select: { id: true } })) throw new BadRequestException("Исполнитель задачи недоступен");
      if (dto.clientId !== undefined && dto.clientId !== null && !await tx.client.findFirst({ where: { id: dto.clientId, archivedAt: null }, select: { id: true } })) throw new BadRequestException("Клиент задачи не найден");
      const task = await tx.workTask.update({ where: { id }, data: {
        title: dto.title?.trim(), description: dto.description === undefined ? undefined : dto.description.trim() || null,
        type: dto.type, clientId: dto.clientId, assigneeId: dto.assigneeId, dueAt: dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null,
        markerColor: dto.markerColor, labels: dto.labels?.map((label) => label.trim()).filter(Boolean),
        attachments: attachments.length ? { create: attachments } : undefined,
      }, include: { attachments: true } });
      if (task.clientId) await tx.activity.create({ data: { clientId: task.clientId, type: "TASK_UPDATED", summary: `Обновлена задача: ${task.title}`, metadata: { taskId: task.id } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "WorkTask", entityId: id, before, after: task } });
      return task;
    });
  }

  async move(id: string, dto: MoveTaskDto, actor: User) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('tasks-kanban'))");
      const before = await tx.workTask.findFirst({ where: { id, archivedAt: null }, include: { column: true } });
      if (!before) throw new NotFoundException("Задача не найдена");
      const column = await tx.taskColumn.findFirst({ where: { id: dto.columnId, archivedAt: null } });
      if (!column) throw new NotFoundException("Колонка задач не найдена");
      const target = await tx.workTask.findMany({ where: { columnId: dto.columnId, archivedAt: null, id: { not: id } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
      const requested = Math.min(dto.position ?? target.length, target.length);
      target.splice(requested, 0, { id });
      const source = before.columnId === dto.columnId ? [] : await tx.workTask.findMany({ where: { columnId: before.columnId, archivedAt: null, id: { not: id } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
      const task = await tx.workTask.update({ where: { id }, data: { columnId: dto.columnId, position: requested, completedAt: column.isDone ? before.completedAt ?? new Date() : null } });
      for (const [position, item] of target.entries()) if (item.id !== id) await tx.workTask.update({ where: { id: item.id }, data: { position } });
      for (const [position, item] of source.entries()) await tx.workTask.update({ where: { id: item.id }, data: { position } });
      if (task.clientId) await tx.activity.create({ data: { clientId: task.clientId, type: "TASK_MOVED", summary: `Задача перемещена в «${column.name}»`, metadata: { taskId: task.id, fromColumnId: before.columnId, toColumnId: column.id } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "MOVE", entityType: "WorkTask", entityId: id, before, after: task } });
      return task;
    });
  }

  async archive(id: string, actor: User) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('tasks-kanban'))");
      const before = await tx.workTask.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundException("Задача не найдена");
      const task = await tx.workTask.update({ where: { id }, data: { archivedAt: new Date() } });
      const remaining = await tx.workTask.findMany({ where: { columnId: before.columnId, archivedAt: null }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
      for (const [position, item] of remaining.entries()) await tx.workTask.update({ where: { id: item.id }, data: { position } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "ARCHIVE", entityType: "WorkTask", entityId: id, before, after: task } });
      return task;
    });
  }

  async createColumn(dto: CreateTaskColumnDto, actor: User) {
    return this.prisma.$transaction(async (tx) => {
      const column = await tx.taskColumn.create({ data: { name: dto.name.trim(), color: dto.color, isDone: dto.isDone ?? false, sortOrder: dto.sortOrder ?? await tx.taskColumn.count({ where: { archivedAt: null } }) } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "CREATE", entityType: "TaskColumn", entityId: column.id, after: column } });
      return column;
    });
  }

  async updateColumn(id: string, dto: UpdateTaskColumnDto, actor: User) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.taskColumn.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundException("Колонка задач не найдена");
      const column = await tx.taskColumn.update({ where: { id }, data: { name: dto.name?.trim(), color: dto.color, isDone: dto.isDone, sortOrder: dto.sortOrder } });
      if (dto.isDone !== undefined && dto.isDone !== before.isDone) await tx.workTask.updateMany({ where: { columnId: id, archivedAt: null }, data: { completedAt: dto.isDone ? new Date() : null } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "TaskColumn", entityId: id, before, after: column } });
      return column;
    });
  }

  async archiveColumn(id: string, actor: User) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.taskColumn.findFirst({ where: { id, archivedAt: null } });
      if (!before) throw new NotFoundException("Колонка задач не найдена");
      if (await tx.workTask.count({ where: { columnId: id, archivedAt: null } })) throw new BadRequestException("Сначала переместите задачи из колонки");
      const column = await tx.taskColumn.update({ where: { id }, data: { archivedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "TASK_COLUMN_ARCHIVED", entityType: "TaskColumn", entityId: id, before, after: column } });
      return column;
    });
  }
}
