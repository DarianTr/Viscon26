import type { Metadata } from "next";
import { CommunityTabs } from "@/components/community/community-tabs";
import { PageHeader } from "@/components/ui/primitives";
import { getClubs, getCurrentUser, getFeed, getLeaderboard } from "@/lib/queries";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage() {
  const user = await getCurrentUser();
  const [feed, leaderboard, clubs] = await Promise.all([
    getFeed(user.id),
    getLeaderboard(user.id),
    getClubs(user.id),
  ]);

  return (
    <>
      <PageHeader eyebrow="Friends & clubs" title="Community" />
      <CommunityTabs feed={feed} leaderboard={leaderboard} clubs={clubs} />
    </>
  );
}
