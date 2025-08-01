import { errorHandlingFetcher } from "@/lib/fetcher";
import useSWR, { mutate } from "swr";
import { useState } from "react";
import { buildApiPath } from "@/lib/urlBuilder";
import {
    convertDateToEndOfDay,
    convertDateToStartOfDay,
    getXDaysAgo,
} from "../dateUtils";
import { DateRange, THIRTY_DAYS } from "../DateRangeSelector";

export type DateRangePickerValue = DateRange & {
    selectValue: string;
};

export const useTimeRange = () => {
    return useState<DateRangePickerValue>({
        to: new Date(),
        from: getXDaysAgo(30),
        selectValue: THIRTY_DAYS,
    });
};

export interface DailyTokenUsage {
    total_tokens: number;
    date: string;
    model_used: string;
}

export const useTokenUsageAnalytics = (timeRange: DateRangePickerValue) => {
    const url = buildApiPath("/api/analytics/token-usage", {
        start: convertDateToStartOfDay(timeRange.from)?.toISOString(),
        end: convertDateToEndOfDay(timeRange.to)?.toISOString(),
    });

    const swrResponse = useSWR<DailyTokenUsage[]>(url, errorHandlingFetcher);

    return {
        ...swrResponse,
        refreshTokenUsageAnalytics: () => mutate(url),
    };
};

export function getDatesList(startDate: Date): string[] {
    const datesList: string[] = [];
    const endDate = new Date();

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        datesList.push(dateStr);
    }

    return datesList;
}
