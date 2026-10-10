import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";

export const Route = createFileRoute("/")({
  component: () => {
    const { isLoading, isAuthenticated } = useConvexAuth();
    if (isLoading) return null;
    return <Navigate to={isAuthenticated ? "/queue" : "/signin"} replace />;
  },
});
