import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
  {
    variants: {
      variant: {
        default: "border-emerald-500/30 bg-emerald-500/12 text-emerald-300",
        neutral: "border-hairline/12 bg-hairline/[0.04] text-muted-foreground",
        success: "border-ok/30 bg-ok/12 text-emerald-300",
        warning: "border-warn/30 bg-warn/12 text-amber-300",
        danger: "border-danger/35 bg-danger/12 text-red-300",
        info: "border-info/30 bg-info/12 text-sky-300",
        outline: "border-hairline/15 text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
