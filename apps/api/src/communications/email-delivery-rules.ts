export const blocksEmailDelivery = (status: string) => status === "PENDING" || status === "UNCERTAIN";
export const canReleaseEmailDelivery = (status: string) => status === "UNCERTAIN";
export const emailSignedContent = (content: string, signature: string) => {
  const cleanSignature = signature.trim();
  if (!cleanSignature || content.trimEnd().endsWith(cleanSignature)) return content;
  return `${content.trimEnd()}\n\n${cleanSignature}`;
};
const emailConnectionKeys=new Set(["enabled","smtpHost","smtpPort","imapHost","imapPort","username","fromAddress"]);
export const emailConnectionSettingsChanged=(current:Record<string,unknown>,entries:Array<[string,unknown]>,passwordChanged:boolean)=>passwordChanged||entries.some(([key,value])=>emailConnectionKeys.has(key)&&JSON.stringify(current[key])!==JSON.stringify(value));
