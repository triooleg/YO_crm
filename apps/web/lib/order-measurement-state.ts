type AthleteRef = { id: string };
type MeasurementRef = { athleteId: string };
type OrderMeasurementRef = {
  type: string;
  athlete?: AthleteRef;
  measurement?: MeasurementRef;
  items: { athlete?: AthleteRef; measurement?: MeasurementRef }[];
};

function owned(measurement?: MeasurementRef, athlete?: AthleteRef) {
  return Boolean(measurement && athlete && measurement.athleteId === athlete.id);
}

export function orderMeasurementState(order: OrderMeasurementRef) {
  const multiple = order.type === "GROUP_ORDER" || order.type === "PAIR" || order.items.length > 1;
  const complete = multiple
    ? order.items.length > 0 && order.items.every(item => owned(item.measurement, item.athlete))
    : owned(order.items[0]?.measurement, order.items[0]?.athlete || order.athlete) || owned(order.measurement, order.items[0]?.athlete || order.athlete);
  return {
    complete,
    problem: complete ? undefined : "dimensions" as const,
    nextAction: complete ? undefined : "dimensions" as const,
  };
}
