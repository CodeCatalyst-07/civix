import { version } from "../../../../package.json";

export function GET(): Response {
  return Response.json({ status: "ok", service: "civix", version });
}
