import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { User } from "@prisma/client";
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { enforceAuthRateLimit } from "./auth-rate-limit";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  private hashToken(token:string){return createHash("sha256").update(token).digest("hex")}
  private testingWithoutLogin(){return process.env.AUTH_DISABLED?.toLowerCase()==="true"}
  publicUser(user:User){return{id:user.id,email:user.email,displayName:user.displayName,role:user.role}}
  async login(email:string,password:string,attemptKey="unknown"){
    await enforceAuthRateLimit("login-ip",attemptKey,30);
    const user=await this.prisma.user.findUnique({where:{email:email.trim().toLowerCase()}});
    if(user)await enforceAuthRateLimit("login-account",user.id,10);
    if(!user?.active||!(await argon2.verify(user.passwordHash,password)))throw new UnauthorizedException("Неверный адрес электронной почты или пароль");
    const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+14*86_400_000);
    await this.prisma.session.create({data:{userId:user.id,tokenHash:this.hashToken(token),expiresAt}});
    return{token,expiresAt,user:this.publicUser(user)};
  }
  async userForToken(token?:string){
    if(this.testingWithoutLogin()){
      const owner=await this.prisma.user.findFirst({where:{active:true,role:"OWNER"}});
      if(!owner)throw new UnauthorizedException("Тестовый пользователь не найден");
      return owner;
    }
    if(!token)throw new UnauthorizedException();
    const session=await this.prisma.session.findUnique({where:{tokenHash:this.hashToken(token)},include:{user:true}});
    if(!session||session.expiresAt<=new Date()||!session.user.active)throw new UnauthorizedException();
    return session.user;
  }
  async logout(token?:string){if(token)await this.prisma.session.deleteMany({where:{tokenHash:this.hashToken(token)}})}
  async updateAccount(actor:User,input:{currentPassword:string;email?:string;newPassword?:string}){
    await enforceAuthRateLimit("account-change",actor.id,5);
    const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+14*86_400_000);
    const updated=await this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id}))`;
      const user=await tx.user.findFirst({where:{id:actor.id,active:true}});
      if(!user||!(await argon2.verify(user.passwordHash,input.currentPassword)))throw new UnauthorizedException("Текущий пароль указан неверно");
      const email=input.email?.trim().toLowerCase()||user.email,changesEmail=email!==user.email,changesPassword=Boolean(input.newPassword);
      if(!changesEmail&&!changesPassword)throw new BadRequestException("Укажите новый логин или пароль");
      if(input.newPassword&&await argon2.verify(user.passwordHash,input.newPassword))throw new BadRequestException("Новый пароль должен отличаться от текущего");
      if(changesEmail&&await tx.user.findFirst({where:{email,id:{not:user.id}}}))throw new ConflictException("Этот e-mail уже используется");
      const data:{email?:string;passwordHash?:string}={};if(changesEmail)data.email=email;if(input.newPassword)data.passwordHash=await argon2.hash(input.newPassword,{type:argon2.argon2id});
      const saved=await tx.user.update({where:{id:user.id},data});
      await tx.session.deleteMany({where:{userId:user.id}});
      await tx.session.create({data:{userId:user.id,tokenHash:this.hashToken(token),expiresAt}});
      await tx.auditLog.create({data:{actorId:user.id,action:"UPDATE",entityType:"UserCredentials",entityId:user.id,before:{email:user.email},after:{email:saved.email,credentialsRotated:true}}});
      return saved;
    });
    return{token,expiresAt,user:this.publicUser(updated)};
  }
}
