"use client";

import { DateRangePickerValue } from "@/components/dateRangeSelectors/AdminDateRangeSelector";
import { useTokenUsageAnalyticsforAdmin, getDatesList } from "../lib";
import { ThreeDotsLoader } from "@/components/Loading";
import { AreaChartDisplay } from "@/components/ui/areaChart";
import Title from "@/components/ui/title";
import Text from "@/components/ui/text";
import CardSection from "@/components/admin/CardSection";

export function AdminTokenUsageChart({
    timeRange,
}: {
    timeRange: DateRangePickerValue;
}) {
    const {
        data: tokenUsageAnalytics,
        isLoading,
        error,
    } = useTokenUsageAnalyticsforAdmin(timeRange);

    let chart;
    if (isLoading) {

        chart = (
            <div className="h-80 flex flex-col">
                <ThreeDotsLoader />
            </div>
        );
    } else if (!tokenUsageAnalytics || error) {
        chart = (
            <div className="h-80 text-red-600 text-bold flex flex-col">
                <p className="m-auto">Failed to fetch new token data...</p>
            </div>
        );
    } else {
        const initialDate =
            timeRange.from || new Date(tokenUsageAnalytics[0].date);
        const dateRange = getDatesList(initialDate);

        // Step 1: Define fixed model → color mapping
        const modelColorMap: Record<string, string> = {
            "gemini-2.5-flash-lite-preview-06-17": "fuchsia",
            "llama3.1-8b": "indigo",
            "llama-3.3-70b-versatile": "purple",
        };

        // Step 2: Always include all models for consistent chart rendering
        const models = Object.keys(modelColorMap);

        // Step 3: Build a map: date -> model -> tokens
        const tokenUsageMap = new Map<string, Map<string, number>>();
        for (const { date, model_used, total_tokens } of tokenUsageAnalytics) {
            if (!tokenUsageMap.has(date)) {
                tokenUsageMap.set(date, new Map());
            }
            tokenUsageMap.get(date)!.set(model_used, total_tokens);
        }

        chart = (
            <AreaChartDisplay
                className="mt-4"
                stacked={false}
                data={dateRange.map((dateStr) => {
                    const modelData = tokenUsageMap.get(dateStr) || new Map();
                    const row: Record<string, string | number> = { Day: dateStr };
                    for (const model of models) {
                        row[model] = modelData.get(model) || 0;
                    }
                    return row;
                })}
                categories={models}
                index="Day"
                colors={models.map((model) => modelColorMap[model])}
                yAxisFormatter={(num: number) =>
                    new Intl.NumberFormat("en-US", {
                        notation: "standard",
                        maximumFractionDigits: 0,
                    }).format(num)
                }
                xAxisFormatter={(dateStr: string) => {
                    const date = new Date(dateStr);
                    return date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                    });
                }}
                yAxisWidth={60}
                allowDecimals={false}
            />
        );
    }

    return (
        <CardSection className="mt-8">
            <Title>Token Usage (All Users)</Title>
            <Text>This chart shows the total number of tokens used per day, aggregated across all users.</Text>
            {chart}
        </CardSection>
    );
}
