import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const isImage = (p: string) => /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(p);

/** Candidate photo from private storage (signed URL), falling back to initials. Click to enlarge. */
export function CandidatePhoto({
  path,
  name,
  size = 48,
  deferUntilVisible = false,
}: {
  path: string | null | undefined;
  name: string;
  size?: number;
  deferUntilVisible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const displaySize = Math.max(64, size);
  const usable = !!path && isImage(path);
  const photoRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!deferUntilVisible || !usable || visible || typeof IntersectionObserver === "undefined")
      return;
    const element = photoRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [deferUntilVisible, usable, visible]);
  const { data: url } = useQuery({
    queryKey: ["photo", path],
    enabled:
      usable && (!deferUntilVisible || visible || typeof IntersectionObserver === "undefined"),
    staleTime: path?.endsWith("/agent-profile.jpg") ? 60 * 1000 : 50 * 60 * 1000,
    refetchInterval: path?.endsWith("/agent-profile.jpg") ? 60 * 1000 : false,
    queryFn: async () => {
      if (!path) return null;
      const result = await supabase.storage.from("candidate-photos").createSignedUrl(path, 3600);
      setFailed(false);
      return result.data?.signedUrl ?? null;
    },
  });
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <>
      <div
        ref={photoRef}
        style={{ width: displaySize, height: displaySize }}
        className={`shrink-0 overflow-hidden rounded-xl border bg-muted ring-2 ring-primary/20 ${url ? "cursor-zoom-in transition-transform hover:scale-105" : ""}`}
        onClick={
          url
            ? (e) => {
                e.stopPropagation();
                e.preventDefault();
                setOpen(true);
              }
            : undefined
        }
        role={url ? "button" : undefined}
        tabIndex={url ? 0 : undefined}
        onKeyDown={
          url
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(true);
                }
              }
            : undefined
        }
        title={url ? "বড় করে দেখুন" : undefined}
      >
        {url && !failed ? (
          <img
            src={url}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-bold text-muted-foreground">
            {initials}
          </div>
        )}
      </div>
      {url && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-3xl p-3" onClick={(e) => e.stopPropagation()}>
            <DialogTitle className="text-center uppercase">{name}</DialogTitle>
            <img src={url} alt={name} className="max-h-[75vh] w-full rounded-xl object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
