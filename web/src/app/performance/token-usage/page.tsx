"use client";

import { UserAggregateTokenUsageChart } from "./UserTokenUsageChart";
import { DateRangeSelector } from "../DateRangeSelector";
import { useTimeRange } from "./lib";
import { FiBarChart2 } from "react-icons/fi";
import { BackButton } from "@/components/BackButton";
import { UserDropdown } from "@/components/UserDropdown";
import { useUser } from "@/components/user/UserProvider";
import { UserRole } from "@/lib/types";
import { Separator } from "@/components/ui/separator";
// import UsageReports from "./UsageReports";

export default function PublicTokenUsagePage() {
    const [timeRange, setTimeRange] = useTimeRange();
    const { user } = useUser();

    const isAdmin = user?.role === UserRole.ADMIN;

    return (
        <main className="min-h-screen relative px-4 pt-20">
            {!isAdmin && (
                <>
                    <div className="absolute top-4 left-4 z-10">
                        <BackButton routerOverride="/chat" />
                    </div>

                    <div className="absolute top-4 right-4 z-10">
                        <UserDropdown page="token-usage" />
                    </div>
                </>
            )}

            <div className="w-full max-w-8xl">
                {!isAdmin && (
                    <div className="flex items-center gap-2 mb-4">
                        <FiBarChart2 size={28} />
                        <h2 className="text-2xl font-semibold">Token Usage Statistics</h2>
                    </div>
                )}

                {!isAdmin && (
                    <DateRangeSelector
                        value={timeRange}
                        onValueChange={(val) => setTimeRange(val)}
                    />
                )}

                <UserAggregateTokenUsageChart timeRange={timeRange} />

                {!isAdmin && (
                    <>
                        <Separator />
                        {/* <UsageReports /> */}
                    </>
                )}
            </div>
        </main>
    );
}
