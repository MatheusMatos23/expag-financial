import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "danger" | "warning" | "info";
  className?: string;
  onClick?: () => void;
}

const variantStyles = {
  default: "text-foreground",
  success: "text-green-400",
  danger: "text-red-400",
  warning: "text-yellow-400",
  info: "text-blue-400",
};

export function MetricCard({
  title, value, subtitle, icon, variant = "default", className, onClick,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "bg-card border border-border rounded-xl p-5 flex flex-col gap-3",
        onClick && "cursor-pointer hover:border-border/60 transition-colors",
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
        {icon && <div className="shrink-0">{icon}</div>}
      </div>
      <div>
        <p className={cn("text-2xl font-bold font-mono", variantStyles[variant])}>{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}
