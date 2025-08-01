// Sidebar.tsx
"use client";
import React, { useContext } from "react";
import Link from "next/link";
import { SettingsContext } from "@/components/settings/SettingsProvider";
import { CgArrowsExpandUpLeft } from "react-icons/cg";
import { LogoComponent } from "@/components/logo/FixedLogo";

interface Item {
  name: string | JSX.Element;
  link: string;
  error?: boolean;
}

interface Collection {
  name: string | JSX.Element;
  items: Item[];
}

export function AdminSidebar({ collections }: { collections: Collection[] }) {
  const combinedSettings = useContext(SettingsContext);
  if (!combinedSettings) {
    return null;
  }

  const enterpriseSettings = combinedSettings.enterpriseSettings;

  return (
    <div className="text-text-settings-sidebar pl-0">
      <nav className="space-y-2">
        <Link href="/chat" className="ml-4 mt-1 mb-4 h-8 flex justify-start w-full cursor-pointer">
          <div title="Go to Chat" className="cursor-pointer">
            <LogoComponent
              show={true}
              enterpriseSettings={enterpriseSettings!}
              backgroundToggled={false}
              isAdmin={true}
            />
          </div>
        </Link>
        <div className="flex w-full justify-center">
          <Link href="/chat">
            <button className="text-sm text-text-700 hover:bg-background-settings-hover dark:hover:bg-neutral-800 flex items-center block w-52 py-2.5 flex px-2 text-left hover:bg-opacity-80 cursor-pointer rounded">
              <CgArrowsExpandUpLeft className="my-auto" size={18} />
              <p className="ml-1 break-words line-clamp-2 ellipsis leading-none">
                Exit Admin
              </p>
            </button>
          </Link>
        </div>
        {collections.map((collection, collectionInd) => (
          <div
            className="flex flex-col items-center justify-center w-full"
            key={collectionInd}
          >
            <h2 className="text-xs text-text-800 w-52 font-bold pb-2">
              <div>{collection.name}</div>
            </h2>
            {collection.items.map((item) => (
              <Link key={item.link} href={item.link}>
                <button
                  className={`text-sm text-text-700 block flex gap-x-2 items-center w-52 py-2.5 px-2 text-left hover:bg-background-settings-hover dark:hover:bg-neutral-800 rounded`}
                >
                  {item.name}
                </button>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      {combinedSettings.webVersion && (
        <div
          className="flex flex-col mt-12 items-center justify-center w-full"
          key={"onyxVersion"}
        >
          <h2 className="text-xs text-text/40 w-52 font-medium">
            Techpeek AI version: {combinedSettings.webVersion}
          </h2>
        </div>
      )}
    </div>
  );
}
