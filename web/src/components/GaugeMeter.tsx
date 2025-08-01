import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell } from "recharts";

interface GaugeMeterProps {
    value: number;
}

const GaugeMeter: React.FC<GaugeMeterProps> = ({ value }) => {
    const [angle, setAngle] = useState<number>(-90); // Start from -90 (leftmost)

    useEffect(() => {
        const newAngle = (value / 100) * 180 - 90; // Convert value to angle (-90 to 90)
        setAngle(newAngle);
    }, [value]);

    const data = [
        { value: 50, color: "#FF5722" }, // Red (Low)
        { value: 50, color: "#FFC107" }, // Yellow (Medium)
        { value: 50, color: "#4CAF50" }, // Green (High)
    ];

    return (
        <div style={{ position: "relative", width: "300px", height: "200px" }}>
            {/* Gauge Chart */}
            <PieChart width={300} height={200}>
                <Pie
                    data={data}
                    cx={150}
                    cy={180}
                    startAngle={180}
                    endAngle={0}
                    innerRadius={70}
                    outerRadius={90}
                    dataKey="value"
                    stroke="none" // Remove the border
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                </Pie>
            </PieChart>

            {/* Needle (Centered & Pointed) */}
            <div
                style={{
                    position: "absolute",
                    top: "125px", // Adjusted for proper centering
                    left: "calc(50% - 2px)", // Centering needle
                    width: "4px",
                    height: "40px", // Shortened needle
                    backgroundColor: "black",
                    transformOrigin: "bottom",
                    transform: `rotate(${angle}deg)`,
                    transition: "transform 0.5s ease-in-out",
                    clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)", // Triangle shape for pointed effect
                }}
            />

            {/* Value Display */}
            <div
                style={{
                    position: "absolute",
                    top: "165px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    fontSize: "18px",
                    fontWeight: "normal",
                }}
            >
                {value}%
            </div>
        </div>
    );
};

export default GaugeMeter;
