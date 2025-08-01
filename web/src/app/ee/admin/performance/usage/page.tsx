"use client";

import { AdminDateRangeSelector } from "../../../../../components/dateRangeSelectors/AdminDateRangeSelector";
import { UserAggregateTokenUsageChart } from "../../../../performance/token-usage/UserTokenUsageChart";
import { OnyxBotChart } from "./OnyxBotChart";
import { FeedbackChart } from "./FeedbackChart";
import { QueryPerformanceChart } from "./QueryPerformanceChart";
import { PersonaMessagesChart } from "./PersonaMessagesChart";
import { useTimeRange } from "../lib";
import { AdminPageTitle } from "@/components/admin/Title";
import { FiActivity } from "react-icons/fi";
import UsageReports from "./UsageReports";
import { Separator } from "@/components/ui/separator";
import { AdminTokenUsageChart } from "./AdminTokenUsageChart";

export default function AnalyticsPage() {
    const [timeRange, setTimeRange] = useTimeRange();

    return (
        <main className="pt-4 mx-auto container">
            <AdminPageTitle
                title="Usage Statistics"
                icon={<FiActivity size={32} />}
            />
            <AdminDateRangeSelector
                value={timeRange}
                onValueChange={(value) => setTimeRange(value as any)}
            />
            <AdminTokenUsageChart timeRange={timeRange} />
            <UserAggregateTokenUsageChart timeRange={timeRange} />
            <QueryPerformanceChart timeRange={timeRange} />
            <FeedbackChart timeRange={timeRange} />
            <OnyxBotChart timeRange={timeRange} />
            <PersonaMessagesChart timeRange={timeRange} />
            <Separator />
            <UsageReports />
        </main>
    );
}
