"use client";
import { CrmAvatar } from "./crm/avatar";
export function ClientAvatar({displayName,avatarUrl,className}:{displayName:string;avatarUrl?:string;className:string}){return <CrmAvatar className={className} name={displayName} src={avatarUrl}/>}
