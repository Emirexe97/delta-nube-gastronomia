import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from "@tanstack/react-query";
import type { BootstrapDto } from "@gastronomy/contracts";

export const bootstrapKey = ["bootstrap"] as const;

export function useBootstrap() {
  return useQuery<BootstrapDto>({
    queryKey: bootstrapKey,
    queryFn: () => {
      if (!window.gastronomy) throw new Error("Abrí esta interfaz desde la aplicación de escritorio.");
      return window.gastronomy.bootstrap();
    }
  });
}

export function useApiMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: Omit<UseMutationOptions<TData, Error, TVariables>, "mutationFn"> = {}
) {
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TVariables>({
    mutationFn: (variables) => {
      if (variables && typeof variables === "object" && !("idempotencyKey" in variables)) {
        (variables as any).idempotencyKey = crypto.randomUUID();
      }
      return mutationFn(variables);
    },
    ...options,
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: bootstrapKey });
      await options.onSuccess?.(data, variables, onMutateResult, context);
    },
    onError: async (error, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: bootstrapKey });
      await options.onError?.(error, variables, onMutateResult, context);
    }
  });
}
