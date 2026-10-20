export type InboxDetailRequest={clientId:string;version:number};

export function isCurrentInboxDetailRequest(request:InboxDetailRequest,selectedClientId:string|undefined,currentVersion:number){
 return request.clientId===selectedClientId&&request.version===currentVersion;
}

export function canRefreshInbox(manualLoadInProgress:boolean,pollInProgress:boolean){return !manualLoadInProgress&&!pollInProgress}

export function isCurrentInboxRefresh(requestVersion:number,currentVersion:number,observedReadVersion:number,currentReadVersion:number){
 return requestVersion===currentVersion&&observedReadVersion===currentReadVersion;
}
