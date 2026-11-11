import { useCallback } from "react";
import { useToast } from "@/shared/ui";
import { useTranslation } from "@/languages";
import type { LocalImportResult } from "@/shared/media/local";
import { useLocalLibraryStore } from "../store/localLibraryStore";

type Translate = ReturnType<typeof useTranslation>["t"];

function plural(key: string, count: number, t: Translate): string {
  return t(`${key}_${count === 1 ? "one" : "other"}`, { count });
}

function announce(
  result: LocalImportResult | null,
  t: Translate,
  toast: ReturnType<typeof useToast>["toast"],
): void {
  if (!result) return;
  const { added, duplicates, failed } = result;
  if (added.length > 0) {
    toast(plural("library.local.imported", added.length, t), "checkmark", {
      description:
        duplicates > 0
          ? plural("library.local.skipped_duplicates", duplicates, t)
          : added.length === 1
            ? added[0].title
            : undefined,
    });
  } else if (duplicates > 0 && failed.length === 0) {
    toast(t("library.local.already_added"), "info");
  }
  if (failed.length > 0) {
    toast(plural("library.local.import_failed", failed.length, t), "error", {
      description: failed.slice(0, 3).join(", "),
    });
  }
}

export function useLocalImport() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const importFilesFn = useLocalLibraryStore((state) => state.importFiles);
  const pickFilesFn = useLocalLibraryStore((state) => state.pickFiles);
  const importing = useLocalLibraryStore((state) => state.importing);

  const importFiles = useCallback(
    async (files: File[]) => {
      announce(await importFilesFn(files), t, toast);
    },
    [importFilesFn, t, toast],
  );

  const chooseFiles = useCallback(async () => {
    announce(await pickFilesFn(), t, toast);
  }, [pickFilesFn, t, toast]);

  return { importFiles, chooseFiles, importing };
}
