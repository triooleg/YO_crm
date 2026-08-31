export const COMMUNICATION_FILE_NAME = /^[a-f0-9-]+\.(jpg|png|webp|gif|pdf|txt|mp4|ogg|mp3|m4a)$/;
export const isCommunicationFileName = (name: string) => COMMUNICATION_FILE_NAME.test(name);
