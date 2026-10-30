"use client";
import { useEffect, useState, type ImgHTMLAttributes, type MouseEvent } from 'react';
import { Anchor, Group, Modal, Text, UnstyledButton } from '@mantine/core';
import { orderImagePreviewUi as ui } from '../../lib/i18n';
import '../../app/order-image-preview.css';

type PreviewOrder = { id: string; number: string };
export function OrderImagePreviewTitle({order,onOpenOrder,target}:{order:PreviewOrder;onOpenOrder?:()=>void;target?:"_blank"}) {
 const href=`/?section=orders&orderId=${encodeURIComponent(order.id)}`;
 function navigate(event:MouseEvent<HTMLAnchorElement>) {
  event.stopPropagation();
  if(onOpenOrder&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();onOpenOrder();}
 }
 return <Group gap={6} wrap="wrap"><Text component="span" fw={600}>{ui.title} —</Text><Anchor href={href} target={target} rel={target?"noreferrer":undefined} onClick={navigate} aria-label={ui.openOrder.replace('{number}',order.number)}>{order.number}</Anchor></Group>;
}

/** Order thumbnails share one accessible, read-only image viewer. */
export function OrderImagePreview({src,alt,order,className,imageProps,onOpenOrder,onPreviewChange,orderLinkTarget}:{src:string|null|undefined;alt:string;order:PreviewOrder;className?:string;imageProps?:Omit<ImgHTMLAttributes<HTMLImageElement>,'src'|'alt'|'className'>;onOpenOrder?:()=>void;onPreviewChange?:(opened:boolean)=>void;orderLinkTarget?:"_blank"}) {
 const [opened,setOpened]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{setOpened(false);setFailed(false);},[src,order.id]);
 useEffect(()=>{onPreviewChange?.(opened&&!failed);return()=>onPreviewChange?.(false);},[opened,failed,onPreviewChange]);
 if(!src||failed)return <span className={`${className??''} order-image-unavailable`} role="img" aria-label={ui.unavailable}>—</span>;
 return <>
  <UnstyledButton type="button" className="order-image-trigger" aria-label={`${ui.open}: ${alt} (${order.number})`} aria-haspopup="dialog" onClick={event=>{event.stopPropagation();setOpened(true);}} onKeyDown={event=>event.stopPropagation()}>
   <img {...imageProps} src={src} alt={alt} className={className} referrerPolicy="no-referrer" onError={event=>{setFailed(true);imageProps?.onError?.(event);}}/>
  </UnstyledButton>
  <Modal opened={opened} onClose={()=>setOpened(false)} title={<OrderImagePreviewTitle order={order} target={orderLinkTarget} onOpenOrder={onOpenOrder?()=>{setOpened(false);onOpenOrder();}:undefined}/>} aria-label={`${ui.title} — ${order.number}`} closeButtonProps={{'aria-label':ui.close}} returnFocus centered size="xl" onClick={event=>event.stopPropagation()} classNames={{content:'order-image-preview-modal'}}>
   <img className="order-image-full" src={src} alt={alt} referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>
  </Modal>
 </>;
}
