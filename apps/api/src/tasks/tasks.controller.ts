import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { User } from "@prisma/client";
import { join } from "node:path";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { uploadsRoot } from "../uploads";
import { CreateTaskColumnDto, CreateTaskDto, MoveTaskDto, UpdateTaskColumnDto, UpdateTaskDto, UploadTaskImageDto } from "./tasks.dto";
import { TasksService } from "./tasks.service";

@Controller("tasks")
@UseGuards(SessionGuard, RolesGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get("board") @Roles("OWNER", "ADMIN", "MANAGER", "PRODUCTION") board(@Query("archived") archived?: string) { return this.tasks.board(archived === "true"); }
  @Get("incoming") @Roles("OWNER", "ADMIN", "MANAGER") incoming() { return this.tasks.incoming(); }
  @Post("images") @Roles("OWNER", "ADMIN", "MANAGER") uploadImage(@Body() dto: UploadTaskImageDto) { return this.tasks.uploadImage(dto); }
  @Get("images/:name") @Roles("OWNER", "ADMIN", "MANAGER", "PRODUCTION") image(@Param("name") name: string, @Res() res: Response) {
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(name)) return res.status(404).end();
    return res.sendFile(join(uploadsRoot(), "task-images", name));
  }
  @Post() @Roles("OWNER", "ADMIN", "MANAGER") create(@Body() dto: CreateTaskDto, @Req() req: Request & { user: User }) { return this.tasks.create(dto, req.user); }
  @Patch(":id") @Roles("OWNER", "ADMIN", "MANAGER") update(@Param("id") id: string, @Body() dto: UpdateTaskDto, @Req() req: Request & { user: User }) { return this.tasks.update(id, dto, req.user); }
  @Patch(":id/move") @Roles("OWNER", "ADMIN", "MANAGER", "PRODUCTION") move(@Param("id") id: string, @Body() dto: MoveTaskDto, @Req() req: Request & { user: User }) { return this.tasks.move(id, dto, req.user); }
  @Post(":id/archive") @Roles("OWNER", "ADMIN", "MANAGER") archive(@Param("id") id: string, @Req() req: Request & { user: User }) { return this.tasks.archive(id, req.user); }
  @Post("columns") @Roles("OWNER", "ADMIN") createColumn(@Body() dto: CreateTaskColumnDto, @Req() req: Request & { user: User }) { return this.tasks.createColumn(dto, req.user); }
  @Patch("columns/:id") @Roles("OWNER", "ADMIN") updateColumn(@Param("id") id: string, @Body() dto: UpdateTaskColumnDto, @Req() req: Request & { user: User }) { return this.tasks.updateColumn(id, dto, req.user); }
  @Post("columns/:id/archive") @Roles("OWNER", "ADMIN") archiveColumn(@Param("id") id: string, @Req() req: Request & { user: User }) { return this.tasks.archiveColumn(id, req.user); }
  @Get(":id") @Roles("OWNER", "ADMIN", "MANAGER", "PRODUCTION") detail(@Param("id") id: string) { return this.tasks.detail(id); }
}
