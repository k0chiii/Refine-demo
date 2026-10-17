import { useAuthToken } from "@convex-dev/auth/react";
import { useEffect, useState } from "react";
import { fetchArtifactBlob } from "@/integrations/api";
import { describeError } from "@/lib/errors";

/** 添付を認可付きで取得し、Blob URL を返す。権限剥奪後は再取得が失敗する（署名 URL を残さない）。 */
export function useArtifactBlob(artifactId: string | null) {
  const token = useAuthToken();
  const [state, setState] = useState<{
    url: string | null;
    blob: Blob | null;
    error: string | null;
    loading: boolean;
  }>({ url: null, blob: null, error: null, loading: false });

  useEffect(() => {
    if (!artifactId || !token) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, blob: null, error: null, loading: true });
    fetchArtifactBlob(token, artifactId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, blob, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            url: null,
            blob: null,
            error: describeError(e).message,
            loading: false,
          });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactId, token]);

  return state;
}
