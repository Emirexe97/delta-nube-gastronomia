import { useQuery } from "@tanstack/react-query";

export const appUpdateQueryKey = ["app-update-status"] as const;
export function useAppUpdateStatus() {
  return useQuery({ queryKey: appUpdateQueryKey, queryFn: () => window.gastronomy.getAppUpdateStatus(), refetchInterval: (query) => query.state.data?.state === "DOWNLOADING" ? 2_000 : 10_000, retry: false });
}
