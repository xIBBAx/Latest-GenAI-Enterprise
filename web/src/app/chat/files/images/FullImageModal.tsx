"use client";

import { useEffect } from "react";
import { buildImgUrl } from "./utils";
import * as Dialog from "@radix-ui/react-dialog";

export function FullImageModal({
  fileId,
  open,
  onOpenChange,
}: {
  fileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // pre-fetch image
  useEffect(() => {
    const img = new Image();
    img.src = buildImgUrl(fileId);
  }, [fileId]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-80 z-50" />
        <Dialog.Content
          className={`fixed 
            inset-0 
            flex
            items-center 
            justify-center
            p-4 
            z-[100] 
            max-w-screen-lg 
            h-fit 
            top-1/2 
            left-1/2 
            -translate-y-2/4
            -translate-x-2/4`}
        >
          <img
            src={buildImgUrl(fileId)}
            alt="Uploaded image"
            className="max-w-full max-h-full"
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
