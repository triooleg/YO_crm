import{join}from"node:path";
export const uploadsRoot=()=>process.env.UPLOADS_DIR??join(process.cwd(),"uploads");
