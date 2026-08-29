import { Body, Controller, Get, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { LoginDto, UpdateAccountDto } from "./login.dto";
import { SessionGuard } from "./session.guard";
import { Roles } from "./roles.decorator";
import { RolesGuard } from "./roles.guard";

const COOKIE = "yoleotard_crm_session";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("login")
  async login(@Body() body: LoginDto,@Req() request:Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body.email, body.password,request.ip||"unknown");
    response.cookie(COOKIE, result.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: result.expiresAt, path: "/" });
    return { user: result.user };
  }
  @UseGuards(SessionGuard)
  @Get("me")
  me(@Req() request: Request & { user: User }) { return { user: this.auth.publicUser(request.user) }; }
  @UseGuards(SessionGuard,RolesGuard)
  @Roles("OWNER")
  @Patch("account")
  async account(@Body() body:UpdateAccountDto,@Req() request:Request&{user:User},@Res({passthrough:true}) response:Response){
    const result=await this.auth.updateAccount(request.user,body);
    response.cookie(COOKIE,result.token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",expires:result.expiresAt,path:"/"});
    return{user:result.user};
  }
  @Post("logout")
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[COOKIE]);
    response.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  }
}
