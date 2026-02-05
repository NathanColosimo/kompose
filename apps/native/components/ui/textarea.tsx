import { Input, type InputProps } from "@/components/ui/input";

type TextareaProps = Omit<InputProps, "type">;

function Textarea({ rows = 6, ...props }: TextareaProps) {
  return <Input {...props} rows={rows} type="textarea" />;
}

export { Textarea };
export type { TextareaProps };
