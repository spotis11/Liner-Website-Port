import localFilesCover from "@classic/assets/local-files-cover.svg";
import { cn } from "@classic/shared/lib";

export default function LocalFilesCover({
  className,
}: {
  className?: string;
}) {
  return (
    <img
      src={localFilesCover}
      alt=""
      draggable={false}
      className={cn("h-full w-full select-none object-cover", className)}
    />
  );
}
