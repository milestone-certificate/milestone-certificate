const neutralPaths = new Set(["/auth", "/portal", "/reset-password", "/result-check"]);
export function isPublicSurface(path: string) {
  return neutralPaths.has(path.replace(/\/+$/, "") || "/");
}
