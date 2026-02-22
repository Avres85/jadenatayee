import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const filePath = path.join(process.cwd(), "public", "portfolio-compressed.pdf");
  if (!fs.existsSync(filePath)) {
    return Response.json(
      {
        error: "Missing public/portfolio-compressed.pdf.",
      },
      { status: 404 },
    );
  }
  const stat = fs.statSync(filePath);

  return Response.json({
    id: "portfolio-compressed-static",
    status: "ready",
    fileSize: stat.size,
    updatedAt: stat.mtime.toISOString(),
    url: "/portfolio-compressed.pdf",
    warning: null,
  });
}
