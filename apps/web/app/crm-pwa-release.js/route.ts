import { webPushUi } from "../../lib/i18n";

export const dynamic = "force-static";

export function GET() {
  const release = [
    process.env.NEXT_PUBLIC_CRM_VERSION,
    process.env.NEXT_PUBLIC_CRM_COMMIT,
  ].join(":");
  const copy = {
    notificationTitle: webPushUi.notificationTitle,
    notificationMessage: webPushUi.notificationMessage,
    notificationWebsiteOrder: webPushUi.notificationWebsiteOrder,
  };
  return new Response(`/* CRM release ${JSON.stringify(release).replaceAll("*/", "* /")} */\nself.crmPushUi = ${JSON.stringify(copy)};\n`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
