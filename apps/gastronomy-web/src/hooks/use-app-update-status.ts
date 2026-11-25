import { useQuery } from "@tanstack/react-query";

export const appUpdateQueryKey = ["app-update-status"] as const;
export function useAppUpdateStatus() {
  return useQuery({
    queryKey: appUpdateQueryKey,
    queryFn: () => window.gastronomy.getAppUpdateStatus(),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "DOWNLOADING" || state === "CHECKING") return 2_000;
      if (state === "DISABLED") return false;
      return 30_000;
    },
    retry: false,
  });
}
