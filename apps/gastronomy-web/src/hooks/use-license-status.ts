import { useQuery } from "@tanstack/react-query";

export const licenseQueryKey = ["license-status"] as const;
export function useLicenseStatus() {
  return useQuery({ queryKey: licenseQueryKey, queryFn: () => window.gastronomy.getLicenseStatus(), refetchInterval: 60_000, retry: false });
}
