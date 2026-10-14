type InboxClientOrderRow = {
  id: string;
  displayName: string;
  lastContactAt: Date | null;
};

type InboxReplyStateRow = {
  clientId: string;
  direction: string;
  createdAt: Date;
};

function latestTimestampByDirection(
  rows: InboxReplyStateRow[],
  direction: "INBOUND" | "OUTBOUND",
) {
  const timestamps = new Map<string, number>();
  for (const row of rows) {
    if (row.direction !== direction) continue;
    const timestamp = row.createdAt.getTime();
    if (timestamp > (timestamps.get(row.clientId) ?? Number.NEGATIVE_INFINITY)) {
      timestamps.set(row.clientId, timestamp);
    }
  }
  return timestamps;
}

export function orderInboxClientRows<T extends InboxClientOrderRow>(
  rows: T[],
  replyStateRows: InboxReplyStateRow[],
) {
  const waitingAt = latestTimestampByDirection(replyStateRows, "INBOUND");
  const answeredAt = latestTimestampByDirection(replyStateRows, "OUTBOUND");
  const contactAt = (row: T) => row.lastContactAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const activity = (row:T) => waitingAt.has(row.id) || answeredAt.has(row.id)
    ? Math.max(waitingAt.get(row.id) ?? Number.NEGATIVE_INFINITY, answeredAt.get(row.id) ?? Number.NEGATIVE_INFINITY)
    : contactAt(row);

  return [...rows].sort((left, right) => {
    const leftActivity = activity(left);
    const rightActivity = activity(right);
    if (leftActivity !== rightActivity) return rightActivity - leftActivity;

    const contactDifference = contactAt(right) - contactAt(left);
    if (contactDifference) return contactDifference;
    const nameDifference = left.displayName.localeCompare(right.displayName, "ru", {
      sensitivity: "base",
    });
    return nameDifference || left.id.localeCompare(right.id);
  });
}
