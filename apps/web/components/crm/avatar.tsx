"use client";
import { Avatar } from "@mantine/core";
import { useEffect, useState } from "react";
import { crmAvatarUi } from "../../lib/i18n";

function initials(name:string){return name.trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()).join("")||"?"}
function safeAvatarUrl(value?:string){if(!value)return "";try{const url=new URL(value);return url.protocol==="https:"?url.toString():""}catch{return ""}}
export function CrmAvatar({name,src,className,size}:{name:string;src?:string;className?:string;size?:number|string}){const source=safeAvatarUrl(src),[failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[source]);return <Avatar className={className} size={size} src={source&&!failed?source:undefined} name={name} color="violet" radius="xl" aria-label={crmAvatarUi.label.replace("{name}",name)} imageProps={{referrerPolicy:"no-referrer",onError:()=>setFailed(true)}}>{initials(name)}</Avatar>}
