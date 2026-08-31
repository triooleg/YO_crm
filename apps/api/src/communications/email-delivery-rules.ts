export const blocksEmailDelivery = (status: string) => status === "PENDING" || status === "UNCERTAIN";
export const canReleaseEmailDelivery = (status: string) => status === "UNCERTAIN";
