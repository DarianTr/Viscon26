import type { Metadata } from "next";
import { CommunityTabs } from "@/components/community/community-tabs";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Community" };

export default function CommunityPage() {
  return (
    <>
      <PageHeader eyebrow="Friends & clubs" title="Community" />
      <CommunityTabs />
    </>
  );
}
