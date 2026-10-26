/** Read-only commercial surcharge from the validated website source snapshot. */
export function websiteOrderCardFee(order:{sourceSystem:string|null;externalData:unknown;priceMinor:number}):number|null {
 if(order.sourceSystem!=='YOLEOTARD_WEBSITE'||!order.externalData||typeof order.externalData!=='object'||Array.isArray(order.externalData))return null;
 const totals=(order.externalData as {totals?:unknown}).totals;
 if(!totals||typeof totals!=='object'||Array.isArray(totals))return null;
 const value=totals as {cardFeeMinor?:unknown;chargedMinor?:unknown};
 return Number.isSafeInteger(value.cardFeeMinor)&&Number(value.cardFeeMinor)>=0&&value.chargedMinor===order.priceMinor?Number(value.cardFeeMinor):null;
}
