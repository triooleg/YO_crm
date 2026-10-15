import type { CrmSectionId } from './crm-sections';
import type {OverviewOrderFilter} from './overview-report';
export type OverviewTarget={section:CrmSectionId;context:Record<string,string>};
export const overviewTargets={
 ordersSource:(source:string,period:string):OverviewTarget=>({section:'orders',context:{source,period,overviewFilter:'period'}}),
 financeSource:(source:string,period:string,currency:string):OverviewTarget=>({section:'finance',context:{source,period,currency,tab:'payments'}}),
 orders:(filter:OverviewOrderFilter,period?:string):OverviewTarget=>({section:'orders',context:{overviewFilter:filter,...(period?{period}:{})}}),
 production:():OverviewTarget=>({section:'production',context:{overviewFilter:'work'}}),
 finance:(period:string,currency:string,tab='payments',metric='received'):OverviewTarget=>({section:'finance',context:{period,currency,tab,metric}}),
 clients:(period:string):OverviewTarget=>({section:'clients',context:{period}}),
 tasks:(taskId?:string):OverviewTarget=>({section:'tasks',context:{assignee:'me',...(taskId?{taskId}:{})}}),
 shipment:(orderId:string,shipmentId?:string|null):OverviewTarget=>({section:'orders',context:{orderId,tab:'delivery',...(shipmentId?{shipmentId}:{})}}),
 shipping:(days?:number):OverviewTarget=>({section:'shipping',context:{filter:'upcoming',...(days?{horizon:String(days)}:{})}}),
 message:(clientId:string,conversationId:string,channel:string):OverviewTarget=>({section:'inbox',context:{clientId,conversationId,channel}}),
 unread:():OverviewTarget=>({section:'inbox',context:{conversationScope:'UNREAD'}}),
 order:(orderId:string):OverviewTarget=>({section:'orders',context:{orderId}}),
};
