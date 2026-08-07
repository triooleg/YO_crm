import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./login.dto";
import { SessionGuard } from "./session.guard";

const COOKIE = "yoleotard_crm_session";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("login")
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body.email, body.password);
    response.cookie(COOKIE, result.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: result.expiresAt, path: "/" });
    return { user: result.user };
  }
  @UseGuards(SessionGuard)
  @Get("me")
  me(@Req() request: Request & { user?: unknown }) { return { user: request.user }; }
  @Post("logout")
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[COOKIE]);
    response.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  }
}
