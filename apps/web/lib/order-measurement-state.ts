type AthleteRef = { id: string };
type MeasurementRef = { athleteId: string };
type OrderMeasurementRef = {
  type: string;
  athlete?: AthleteRef|null;
  measurement?: MeasurementRef|null;
  compositionManaged?:boolean;
  items: { quantity?:number;archivedAt?:unknown;athlete?: AthleteRef|null; measurement?: MeasurementRef|null;instances?:{archivedAt?:unknown;athlete?:AthleteRef|null;measurement?:MeasurementRef|null}[] }[];
};

function owned(measurement?: MeasurementRef|null, athlete?: AthleteRef|null) {
  return Boolean(measurement && athlete && measurement.athleteId === athlete.id);
}

export function orderMeasurementState(order: OrderMeasurementRef) {
  const items=order.items.filter(item=>!item.archivedAt),physical=items.some(item=>item.instances!==undefined);
  const multiple = order.type === "GROUP_ORDER" || order.type === "PAIR" || items.length > 1;
  const complete = !items.length&&order.compositionManaged?true:physical
    ?items.length>0&&items.every(item=>{const pieces=item.instances?.filter(piece=>!piece.archivedAt);return Boolean(pieces?.length)&&(item.quantity===undefined||pieces!.length===item.quantity)&&pieces!.every(piece=>owned(piece.measurement,piece.athlete));})
    :multiple?items.length > 0 && items.every(item => owned(item.measurement, item.athlete))
    : owned(items[0]?.measurement, items[0]?.athlete || order.athlete) || owned(order.measurement, items[0]?.athlete || order.athlete);
  return {
    complete,
    problem: complete ? undefined : "dimensions" as const,
    nextAction: complete ? undefined : "dimensions" as const,
  };
}
