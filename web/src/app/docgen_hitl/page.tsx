"use client";

import React, { useState, useEffect, useRef } from "react";
import { FaTrashAlt, FaPlus, FaRegCopy, FaCheck, FaStop, FaPlay } from "react-icons/fa";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { FadeLoader } from "react-spinners";
// import FunctionalWrapper from "../chat/shared_chat_search/FunctionalWrapper";
// import { HistorySidebar } from "../chat/sessionSidebar/TechpeekHistorySidebar";
// import { useSidebarVisibility } from "@/components/chat_search/hooks";
import Cookies from "js-cookie";
import { SIDEBAR_TOGGLED_COOKIE_NAME } from "@/components/resizable/constants";
import ReactMarkdown from "react-markdown";
import axios from "axios";

const Toast = ({ message, onClose }: { message: string; onClose: () => void }) => {
    const [isExiting, setIsExiting] = useState(false); // Track exit animation

    const handleClose = () => {
        setIsExiting(true); // Trigger the slide-out animation
        setTimeout(onClose, 400); // Delay the onClose to match animation duration
    };

    return (
        <div
            className={`fixed top-4 right-4 bg-green-500 text-white shadow-lg rounded-lg px-6 py-4 flex items-center space-x-4 ${isExiting ? "animate-slide-out" : "animate-slide-in"
                }`}
        >
            <div className="text-lg font-medium">{message}</div>
            <button
                onClick={handleClose}
                className="text-sm font-bold text-green-700 dark:text-green-100 bg-white dark:bg-gray-800 px-4 py-2 rounded-md shadow-md hover:bg-green-100 hover:text-green-900 transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
                Dismiss
            </button>
            <style jsx>{`
                @keyframes slide-in {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }

                @keyframes slide-out {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                }

                .animate-slide-in {
                    animation: slide-in 0.4s ease-out forwards;
                }

                .animate-slide-out {
                    animation: slide-out 0.4s ease-out forwards;
                }
            `}</style>
        </div>
    );
};

const Page: React.FC = () => {
    // State for document type and description
    const [documentType, setDocumentType] = useState("");
    const [documentDescription, setDocumentDescription] = useState("");

    const [mergedDocument, setMergedDocument] = useState(""); // For the merged document
    const [showMergeButton, setShowMergeButton] = useState(false); // To control the visibility of the button

    // State for titles, save and generated document
    const [titles, setTitles] = useState<string[]>([]);
    const [modifiedTitles, setModifiedTitles] = useState<string[]>([]);
    const [generatedDocument, setGeneratedDocument] = useState<{ title: string; content: string }[]>([]);
    const [editableContentIndexes, setEditableContentIndexes] = useState<number[]>([]);
    const [areTitlesSaved, setAreTitlesSaved] = useState(false); // Track if titles are saved

    // State for managing loading and progress
    const [isLoading, setIsLoading] = useState(false);
    const [progressMessage, setProgressMessage] = useState("Initializing...");
    const [error, setError] = useState("");
    // For Toast Component
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    // For Cancel Disabled button
    const [isCancelDisabled, setIsCancelDisabled] = useState(false);

    // Tracks which title inputs are editable    
    const [editableIndexes, setEditableIndexes] = useState<number[]>([]);

    const [mergeNotification, setMergeNotification] = useState(false); // State for merge notification

    const documentSectionsRef = useRef<HTMLDivElement | null>(null); // Reference for document sections
    const generatedDocumentRef = useRef<HTMLDivElement | null>(null); // Reference for generated document
    const [isFetchingSections, setIsFetchingSections] = useState(false);
    const [isFetchingGeneratedDocument, setIsFetchingGeneratedDocument] = useState(false);
    const sectionAbortController = useRef<AbortController | null>(null);
    const documentAbortController = useRef<AbortController | null>(null);
    const [actionState, setActionState] = useState("start");
    const [isBeginDisabled, setIsBeginDisabled] = useState(false);
    const [mergedTitles, setMergedTitles] = useState(""); // For merged titles

    const [generationCompleted, setGenerationCompleted] = useState(false);

    const [showDocSidebar, setShowDocSidebar] = useState(false);
    const [untoggled, setUntoggled] = useState(false);
    const sidebarElementRef = useRef<HTMLDivElement>(null);
    const innerSidebarElementRef = useRef<HTMLDivElement>(null);

    const [copiedStatus, setCopiedStatus] = useState<
        Record<number, { title?: boolean; content?: boolean }>
    >({});

    const handleCopy = (text: string, index: number, field: "title" | "content") => {
        // Fallback for unsupported Clipboard API
        const fallbackCopy = (textToCopy: string) => {
            const textarea = document.createElement("textarea");
            textarea.value = textToCopy;
            textarea.style.position = "fixed"; // Avoid scrolling to the textarea
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
        };

        // Try Clipboard API or fallback
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                setCopiedStatus((prev) => ({
                    ...prev,
                    [index]: { ...prev[index], [field]: true },
                }));
                setTimeout(() => {
                    setCopiedStatus((prev) => ({
                        ...prev,
                        [index]: { ...prev[index], [field]: false },
                    }));
                }, 2000); // Revert after 2 seconds
            });
        } else {
            fallbackCopy(text);
            setCopiedStatus((prev) => ({
                ...prev,
                [index]: { ...prev[index], [field]: true },
            }));
            setTimeout(() => {
                setCopiedStatus((prev) => ({
                    ...prev,
                    [index]: { ...prev[index], [field]: false },
                }));
            }, 2000);
        }
    };

    // API base URL
    // const API_BASE_URL = "http://13.202.103.72:8002";
    const API_BASE_URL = "/api/docgen_hitl";

    // Poll backend for progress updates
    useEffect(() => {
        let interval: NodeJS.Timeout | undefined;
        if (isLoading) {
            interval = setInterval(async () => {
                try {
                    const response = await axios.get(`${API_BASE_URL}/get_progress`);
                    setProgressMessage(response.data.status || "Fetching progress...");
                } catch {
                    setProgressMessage("Fetching progress...");
                }
            }, 2000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isLoading]);

    useEffect(() => {
        if (generatedDocument.length > 0 && generationCompleted) {
            setShowMergeButton(true);
        }
    }, [generationCompleted, generatedDocument]);

    // Handle "Init Document Generation"
    const handleInitDocument = async () => {
        if (actionState === "start") {
            setActionState("stop");
            setIsCancelDisabled(true); // Disable the "Clear All" button
            setError(""); // Clear previous errors
            setTitles([]); // Reset titles
            setModifiedTitles([]); // Reset modified titles
            setProgressMessage("Initializing document generation...");
            setIsFetchingSections(true);

            if (!documentType || !documentDescription) {
                setError("Document type and description are required.");
                setActionState("start"); // Revert the state if validation fails
                setIsCancelDisabled(false); // Re-enable "Clear All"
                return;
            }

            sectionAbortController.current = new AbortController();
            const { signal } = sectionAbortController.current;

            setIsLoading(true);

            try {
                const response = await fetch(`${API_BASE_URL}/fetch_titles`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        document_title: documentType,
                        document_info: documentDescription,
                    }),
                    signal,
                });

                if (!response.body) {
                    throw new Error("No response body received from server.");
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let done = false;

                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;

                    if (value) {
                        const chunk = decoder.decode(value);
                        chunk.split("\n").forEach((line) => {
                            if (line.trim()) {
                                try {
                                    const json = JSON.parse(line);
                                    if (json.title) {
                                        setTitles((prevTitles) => [...prevTitles, json.title]);
                                        setModifiedTitles((prevTitles) => [...prevTitles, json.title]);
                                    } else if (json.error) {
                                        setError(json.error);
                                    }
                                } catch (err) {
                                    console.error("Failed to parse JSON:", err);
                                }
                            }
                        });
                    }
                }
            } catch (err) {
                if (err instanceof Error && err.name === "AbortError") {
                    setError("Fetching document sections stopped.");
                } else {
                    setError("Failed to fetch document titles. Please try again.");
                }
                console.error(err);
            } finally {
                setIsFetchingSections(false);
                setIsLoading(false);
                setProgressMessage("");
                setActionState("start"); // Reset to start state
                setIsCancelDisabled(false); // Re-enable "Clear All" button
            }
        } else {
            setActionState("start");
            if (sectionAbortController.current) {
                sectionAbortController.current.abort();
            }
            setIsFetchingSections(false);
            setIsLoading(false);
            setProgressMessage("Process stopped.");
            setIsCancelDisabled(false); // Re-enable "Clear All" button
        }
    };

    // Handle "Clear"
    const handleClear = () => {
        if (isCancelDisabled) return; // Prevent cancel button from working when disabled
        setDocumentType("");
        setDocumentDescription("");
        setTitles([]);
        setModifiedTitles([]);
        setGeneratedDocument([]);
        setMergedDocument(""); // Clear merged document
        setMergedTitles(""); // Clear merged titles
        setShowMergeButton(false); // Hide the merge button
        setError("");
        setProgressMessage("");
        setIsCancelDisabled(false); // Re-enable the cancel button
    };

    const handleMerge = () => {
        const mergedContent = generatedDocument
            .map(({ title, content }) => `${title}\n\n${content}`)
            .join("\n\n--------------------------------------\n\n");
        setMergedDocument(mergedContent);

        // Show the merge notification
        setMergeNotification(true);

        // Automatically hide the notification after 3 seconds
        setTimeout(() => setMergeNotification(false), 3000);
    };

    const explicitlyUntoggle = () => {
        setShowDocSidebar(false);
        setUntoggled(true);
        setTimeout(() => setUntoggled(false), 200);
    };

    const toggleSidebar = () => {
        Cookies.set(
            SIDEBAR_TOGGLED_COOKIE_NAME,
            String(!showDocSidebar).toLocaleLowerCase()
        );
        setShowDocSidebar(!showDocSidebar);
    };

    const removeToggle = () => {
        setShowDocSidebar(false);
    };

    // useSidebarVisibility({
    //     toggledSidebar: showDocSidebar,
    //     sidebarElementRef,
    //     showDocSidebar,
    //     setShowDocSidebar,
    //     setToggled: removeToggle,
    //     mobile: false, // Adjust based on your app's mobile settings
    // });

    const handleMergeTitles = () => {
        const mergedContent = generatedDocument
            .map(({ title }) => title) // Only include titles
            .join("\n\n"); // Use double line breaks instead of separators
        setMergedTitles(mergedContent);

        // Show a notification similar to the merge notification for titles
        setMergeNotification(true);
        setTimeout(() => setMergeNotification(false), 3000); // Auto-hide after 3 seconds
    };

    const handleStopFetchingSections = () => {
        if (sectionAbortController.current) {
            sectionAbortController.current.abort();
            setIsFetchingSections(false); // Stop fetching
        }
    };

    // Add this inside handleStopFetchingGeneratedDocument function
    const handleStopFetchingGeneratedDocument = () => {
        if (documentAbortController.current) {
            documentAbortController.current.abort(); // Abort the request
            setIsFetchingGeneratedDocument(false); // Stop fetching state
            setProgressMessage("Document Generation Stopped"); // Feedback to user
            setIsLoading(false); // Ensure loading spinner stops
            setIsBeginDisabled(false); // Enable "Begin (1/2)" button
        }
    };

    // Handle title modification
    const handleTitleChange = (index: number, newTitle: string) => {
        const updatedTitles = [...modifiedTitles];
        updatedTitles[index] = newTitle;
        setModifiedTitles(updatedTitles);
        setAreTitlesSaved(false); // Reset the saved state when titles are modified
    };


    // Handle "Proceed to Document Generation"
    const handleGenerateDocument = async () => {
        if (modifiedTitles.some((title) => title.trim() === "")) {
            setToastMessage("Please ensure all titles are filled before proceeding."); // Show toast notification
            return;
        }

        setError("");
        setIsFetchingGeneratedDocument(true);
        setIsLoading(true);
        setIsCancelDisabled(true); // Disable the cancel button
        setIsBeginDisabled(true); // Disable "Begin (1/2)" button during the process
        setProgressMessage("Processing document generation...");

        documentAbortController.current = new AbortController();
        const { signal } = documentAbortController.current;

        try {
            await axios.post(`${API_BASE_URL}/save_titles`, {
                titles: modifiedTitles,
            });

            const response = await fetch(`${API_BASE_URL}/docgen_hitl`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    document_title: documentType,
                    document_info: documentDescription,
                }),
                signal,
            });

            if (!response.body) {
                throw new Error("No response body received from server.");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let done = false;

            setGeneratedDocument([]); // Reset the document

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;

                if (value) {
                    const chunk = decoder.decode(value);
                    chunk.split("\n").forEach((line) => {
                        if (line.trim()) {
                            try {
                                const json = JSON.parse(line);
                                if (json.title && json.content) {
                                    setGeneratedDocument((prev) => [
                                        ...prev,
                                        { title: json.title, content: json.content },
                                    ]);
                                } else if (json.error) {
                                    setError(json.error);
                                } else if (json.progress) {
                                    setProgressMessage(json.progress);
                                }
                            } catch (err) {
                                console.error("Failed to parse JSON:", err);
                            }
                        }
                    });
                }
            }

            setProgressMessage("Document generation completed.");
            setGenerationCompleted(true);
            setTimeout(() => {
                setGenerationCompleted(false);
                setIsBeginDisabled(false); // Re-enable "Begin (1/2)" after completion
            }, 4000);
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                setError("Fetching document sections stopped.");
            } else {
                setError("Failed to fetch document titles. Please try again.");
            }
            console.error(err);
        } finally {
            setIsFetchingGeneratedDocument(false);
            setIsLoading(false);
            setIsCancelDisabled(false);
        }
    };

    return (

        <>
            {/* Add HistorySidebar */}
            {/* <div
                        ref={sidebarElementRef}
                        className={`fixed left-0 z-30 bg-background-100 h-screen transition-all bg-opacity-80 duration-300 ease-in-out
                        ${!untoggled && showDocSidebar ? "opacity-100 w-[250px] translate-x-0" : "opacity-0 w-[200px] pointer-events-none -translate-x-10"}`}
                    >
                        <div className="w-full relative">
                            <HistorySidebar
                                explicitlyUntoggle={explicitlyUntoggle}
                                stopGenerating={() => { }}
                                reset={() => { }}
                                page="chat"
                                ref={innerSidebarElementRef}
                                toggleSidebar={toggleSidebar}
                                toggled={showDocSidebar}
                                existingChats={[]} // Pass relevant data
                                currentChatSession={null} // Pass relevant data
                                folders={[]} // Pass relevant data
                                openedFolders={[]} // Pass relevant data
                                removeToggle={removeToggle}
                                showShareModal={() => { }}
                                showDeleteModal={() => { }}
                            />
                        </div>
                    </div> */}

            <div className="flex items-center justify-center min-h-screen bg-[#fafafa] dark:bg-gray-900">
                {/* Toast Component */}
                {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}

                <div className="absolute top-8 left-8">
                    <button
                        onClick={() => (window.location.href = "http://13.202.205.217/chat")}
                        className="flex items-center text-blue-600 hover:text-blue-800 font-semibold text-sm px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md transition-all duration-300"
                    >
                        ← Return to Chat
                    </button>
                </div>

                <div className="w-full max-w-7xl p-16 bg-white dark:bg-gray-800 text-black dark:text-white rounded-lg shadow-lg">
                    {generationCompleted && (
                        <div
                            className="fixed top-16 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white text-lg font-medium px-8 py-4 rounded-md shadow-xl transition-transform transition-opacity duration-500 ease-out opacity-100 scale-100"
                            style={{
                                animation: "fadeSlideInOut 3s forwards",
                            }}
                        >
                            Document Generation Completed!
                        </div>
                    )}

                    {/* Merge Notification */}
                    {mergeNotification && (
                        <div
                            className="fixed top-16 left-1/2 transform -translate-x-1/2 bg-green-600 text-white text-lg font-medium px-8 py-4 rounded-md shadow-xl transition-transform transition-opacity duration-500 ease-out"
                            style={{
                                animation: "fadeSlideInOut 3s forwards",
                            }}
                        >
                            Titles and contents have been successfully merged!
                        </div>
                    )}
                    <div className="flex items-center justify-center mb-8">
                        <h1
                            className="text-4xl font-extrabold text-gray-800 dark:text-white"
                        >
                            HITL Document Generation System
                        </h1>
                    </div>

                    {/* Document Type and Description */}
                    <div className="mb-8">
                        <label className="block text-lg font-medium mb-2">Document Type</label>
                        <input
                            type="text"
                            value={documentType}
                            onChange={(e) => setDocumentType(e.target.value)}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-black dark:text-white rounded-lg focus:outline-none focus:ring-0"
                        />

                        <label className="block text-lg font-medium mt-6 mb-2">Description</label>
                        <textarea
                            value={documentDescription}
                            onChange={(e) => {
                                setDocumentDescription(e.target.value);
                                e.target.style.height = "auto"; // Reset height
                                e.target.style.height = `${e.target.scrollHeight}px`; // Set new height based on scroll
                            }}
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-black dark:text-white rounded-lg focus:outline-none focus:ring-0 resize-none overflow-hidden"
                            rows={5}
                        />

                        <div className="mt-6 flex justify-between">
                            <button
                                onClick={handleInitDocument}
                                disabled={isBeginDisabled} // Disable based on state
                                className={`px-4 py-2 text-white rounded-lg shadow-md focus:outline-none ${isBeginDisabled ? "bg-gray-300 text-gray-500 cursor-not-allowed" : isLoading ? "bg-red-500" : "bg-blue-500"
                                    }`}
                                title={
                                    isBeginDisabled
                                        ? "Disabled during Finalize (2/2) or generation process"
                                        : "Begin Document Generation"
                                }
                            >
                                {actionState === "start" ? (
                                    <>
                                        <FaPlay className="inline-block mr-2" />
                                        Begin (1/2)
                                    </>
                                ) : (
                                    <>
                                        <FaStop className="inline-block mr-2" />
                                        Stop
                                    </>
                                )}
                            </button>
                            <button
                                onClick={handleClear}
                                disabled={isCancelDisabled || titles.length === 0} // Ensure button is disabled when `isCancelDisabled` is true
                                className={`px-4 py-2 rounded-lg shadow-md transition-all duration-300 ease-in-out transform hover:scale-105 ${isCancelDisabled
                                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                    : "bg-red-500 text-white hover:bg-red-600"
                                    }`}
                                title={
                                    isCancelDisabled
                                        ? "Disabled during document generation"
                                        : "Clear all inputs"
                                } // Change tooltip dynamically
                            >
                                Clear All
                            </button>
                        </div>
                    </div>

                    {/* Titles Section */}
                    {titles.length > 0 && (
                        <div ref={documentSectionsRef} className="mb-8">
                            <h2 className="text-xl font-semibold mb-4">Document Sections</h2>
                            {modifiedTitles.map((title, index) => (
                                <div key={index} className="mb-3 flex items-center">
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => {
                                            if (editableIndexes.includes(index)) {
                                                handleTitleChange(index, e.target.value);
                                            } else {
                                                setToastMessage("Please click the edit icon to modify the title.");
                                            }
                                        }}
                                        className={`w-full p-3 border rounded-lg mr-3 font-medium ${editableIndexes.includes(index) ? "border-gray-300" : "border-gray-200 bg-gray-100 cursor-not-allowed"
                                            }`}
                                        readOnly={!editableIndexes.includes(index)} // Disable editing if not in editableIndexes
                                        onClick={() => {
                                            if (!editableIndexes.includes(index)) {
                                                setToastMessage("Please click the edit icon to modify the title.");
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={() => {
                                            if (!editableIndexes.includes(index)) {
                                                setEditableIndexes((prev) => [...prev, index]);
                                            }
                                        }}
                                        className="text-black dark:text-white hover:text-gray-300 hover:shadow-lg transition-all duration-300 ease-in-out flex items-center justify-center mr-3"
                                        aria-label={`Edit title ${index + 1}`}
                                        title="Edit the Titles"
                                    >
                                        <FontAwesomeIcon icon={faPenToSquare} className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => {
                                            const updatedTitles = [...modifiedTitles];
                                            updatedTitles.splice(index, 1); // Remove the title
                                            setModifiedTitles(updatedTitles);

                                            // Update state for unsaved changes
                                            setAreTitlesSaved(false);

                                            // Remove the index from editableIndexes
                                            setEditableIndexes((prev) => prev.filter((i) => i !== index));
                                        }}
                                        className="text-red-500 hover:text-red-700 flex items-center justify-center mr-3"
                                        aria-label="Remove Title"
                                    >
                                        <FaTrashAlt className="w-4 h-4 text-black hover:text-black-500" />
                                    </button>
                                    <div aria-live="polite" aria-atomic="true">
                                        <button
                                            onClick={() => handleCopy(title, index, "title")}
                                            className={`${copiedStatus[index]?.title ? "text-black-500" : "text-black-500"
                                                } hover:text-gray-700 flex items-center justify-center mr-3`}
                                            aria-label="Copy Title"
                                            title="Copy the Title"
                                        >
                                            {copiedStatus[index]?.title ? (
                                                <FaCheck className="w-4 h-4 text-black hover:text-black-500" />
                                            ) : (
                                                <FaRegCopy className="w-4 h-4 text-black hover:text-black-500" />
                                            )}
                                        </button>
                                    </div>

                                    {index === modifiedTitles.length - 1 && ( // Add icon for the last input
                                        <button
                                            onClick={() => {
                                                const updatedTitles = [...modifiedTitles, ""]; // Add an empty title
                                                setModifiedTitles(updatedTitles);
                                                setAreTitlesSaved(false); // Mark titles as unsaved
                                            }}
                                            className="text-green-500 hover:text-green-700 flex items-center justify-center"
                                            aria-label="Add Title"
                                        >
                                            <FaPlus className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <div className="flex justify-between mt-4">
                                <button
                                    onClick={async () => {
                                        try {
                                            setIsLoading(true);
                                            setIsCancelDisabled(true); // Disable the cancel button
                                            const response = await axios.post(`${API_BASE_URL}/save_titles`, {
                                                titles: modifiedTitles,
                                            });
                                            setAreTitlesSaved(true); // Mark titles as saved
                                            setToastMessage(response.data.message || "Titles saved successfully!");
                                        } catch {
                                            setToastMessage("Failed to save titles. Please try again.");
                                        } finally {
                                            setIsLoading(false); // Hide loading indicator
                                            setIsCancelDisabled(false); // Re-enable the cancel button
                                            setTimeout(() => setToastMessage(null), 3000); // Hide toast after 3 seconds
                                        }
                                    }}
                                    disabled={isLoading || areTitlesSaved}
                                    className={`px-4 py-2 ${areTitlesSaved
                                        ? "bg-green-500 text-white cursor-not-allowed"
                                        : "bg-blue-500 hover:bg-blue-600 text-white"
                                        } rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-300 ease-in-out transform hover:scale-105`}
                                    onMouseEnter={() =>
                                        !areTitlesSaved &&
                                        setProgressMessage("Save the titles before proceeding to document generation.")
                                    }
                                    onMouseLeave={() => setProgressMessage("")}
                                >
                                    {isLoading ? (
                                        <div className="flex items-left">
                                            <svg
                                                className="animate-spin h-5 w-5 mr-2 text-white"
                                                xmlns="http://www.w3.org/2000/svg"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                            >
                                                <circle
                                                    className="opacity-25"
                                                    cx="12"
                                                    cy="12"
                                                    r="10"
                                                    stroke="currentColor"
                                                    strokeWidth="4"
                                                ></circle>
                                                <path
                                                    className="opacity-75"
                                                    fill="currentColor"
                                                    d="M4 12a8 8 0 018-8v4a4 4 0 100 8v4a8 8 0 01-8-8z"
                                                ></path>
                                            </svg>
                                            Processing your Request...
                                        </div>
                                    ) : areTitlesSaved ? (
                                        "Titles Saved!"
                                    ) : (
                                        "Save Titles"
                                    )}
                                </button>

                                <button
                                    onClick={() => {
                                        if (isFetchingGeneratedDocument) {
                                            handleStopFetchingGeneratedDocument(); // Invoke stop fetching logic
                                        } else {
                                            if (!areTitlesSaved) {
                                                setToastMessage("Please save the titles before proceeding to document generation.");
                                                return;
                                            }
                                            handleGenerateDocument(); // Start generation process
                                        }
                                    }}
                                    className={`px-4 py-2 text-white rounded-lg shadow-md focus:outline-none ${isFetchingGeneratedDocument ? "bg-red-500" : "bg-green-500"
                                        } hover:bg-green-600`}
                                >
                                    {isFetchingGeneratedDocument ? (
                                        <>
                                            <FaStop className="inline-block mr-2" />
                                            Stop
                                        </>
                                    ) : (
                                        <>
                                            <FaPlay className="inline-block mr-2" />
                                            Finalize (2/2)
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Generated Document Section */}
                    {generatedDocument.length > 0 && (
                        <div ref={generatedDocumentRef}>
                            <h2 className="text-xl font-semibold mb-4">Generated Document</h2>
                            {generatedDocument.map((section, index) => (
                                <div key={index} className="mb-6">
                                    {/* Editable Title */}
                                    <label className="block text-sm font-medium mb-2">Title</label>
                                    <div className="flex items-center">
                                        <input
                                            type="text"
                                            value={section.title}
                                            onChange={(e) => {
                                                const updatedDocument = [...generatedDocument];
                                                updatedDocument[index].title = e.target.value;
                                                setGeneratedDocument(updatedDocument);
                                            }}
                                            className="w-full p-3 border border-gray-300 rounded-lg mr-3 font-bold"
                                        />
                                        <button
                                            onClick={() => {
                                                handleCopy(section.title, index, "title");
                                            }} // Copy title text
                                            className={`${copiedStatus[index]?.title ? "text-black-500" : "text-black-500"
                                                } hover:text-gray-700 flex items-center justify-center`}
                                            aria-label="Copy Title"
                                            title="Copy Title"
                                        >
                                            {copiedStatus[index]?.title ? (
                                                <FaCheck className="w-4 h-4" />
                                            ) : (
                                                <FaRegCopy className="w-4 h-4" />
                                            )}
                                        </button>
                                        <div aria-live="polite" aria-atomic="true">
                                        </div>
                                    </div>

                                    {/* Editable Content */}
                                    <label className="block text-sm font-medium mb-2 mt-4">Content</label>
                                    <div className="flex items-center">
                                        <div className="w-full mr-3">
                                            {editableContentIndexes.includes(index) ? (
                                                <textarea
                                                    value={section.content}
                                                    onChange={(e) => {
                                                        const updatedDoc = [...generatedDocument];
                                                        updatedDoc[index].content = e.target.value;
                                                        setGeneratedDocument(updatedDoc);
                                                    }}
                                                    className="w-full p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-black dark:text-white"
                                                    rows={6}
                                                />
                                            ) : (
                                                <div className="prose dark:prose-invert max-w-none w-full p-4 border border-gray-300 rounded-lg bg-white dark:bg-gray-700">
                                                    <ReactMarkdown>{section.content}</ReactMarkdown>
                                                </div>
                                            )}
                                        </div>

                                        <button
                                            onClick={() => {
                                                handleCopy(section.content, index, "content");
                                            }} // Copy content text
                                            className={`${copiedStatus[index]?.content ? "text-black-500" : "text-black-500"
                                                } hover:text-gray-700 flex items-center justify-center`}
                                            aria-label="Copy Content"
                                            title="Copy Content"
                                        >
                                            {copiedStatus[index]?.content ? (
                                                <FaCheck className="w-4 h-4" />
                                            ) : (
                                                <FaRegCopy className="w-4 h-4" />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (editableContentIndexes.includes(index)) {
                                                    setEditableContentIndexes((prev) => prev.filter((i) => i !== index));
                                                } else {
                                                    setEditableContentIndexes((prev) => [...prev, index]);
                                                }
                                            }}
                                            className="ml-2 text-black dark:text-white hover:text-gray-500"
                                            title={editableContentIndexes.includes(index) ? "Done Editing" : "Edit Content"}
                                        >
                                            <FontAwesomeIcon icon={faPenToSquare} className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div
                                        aria-live="polite"
                                        aria-atomic="true"
                                        className={`fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg transition-all duration-300 ease-in-out ${copiedStatus[index]?.content ? "scale-100 opacity-100" : "scale-0 opacity-0"
                                            }`}
                                    >
                                        {copiedStatus[index]?.content && <span>Content copied successfully!</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {showMergeButton && (
                        <div className="mt-8 text-center flex justify-center space-x-4"> {/* Add flex and space */}
                            <button
                                onClick={handleMerge}
                                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm font-medium rounded-lg shadow-md hover:shadow-lg hover:from-blue-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all duration-300 transform hover:scale-105"
                            >
                                Merge Titles & Contents into a Single Document
                            </button>

                            <button
                                onClick={handleMergeTitles}
                                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm font-medium rounded-lg shadow-md hover:shadow-lg hover:from-blue-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all duration-300 transform hover:scale-105"
                            >
                                Merge Titles into a Single Document
                            </button>
                        </div>
                    )}

                    {mergedDocument && (
                        <div className="mt-8">
                            <label className="block text-lg font-medium mb-4">Merged Document</label>
                            <div className="relative">
                                <div className="prose dark:prose-invert max-w-none w-full p-6 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-black dark:text-white rounded-lg">
                                    <ReactMarkdown>{mergedDocument}</ReactMarkdown>
                                </div>

                                <button
                                    onClick={() => handleCopy(mergedDocument, 0, "content")}
                                    className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
                                    title="Copy Merged Document"
                                >
                                    {copiedStatus[0]?.content ? (
                                        <FaCheck className="w-5 h-5" />
                                    ) : (
                                        <FaRegCopy className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {mergedTitles && (
                        <div className="mt-8">
                            <label className="block text-lg font-medium mb-4">Merged Titles</label>
                            <div className="relative">
                                <textarea
                                    value={mergedTitles}
                                    onChange={(e) => setMergedTitles(e.target.value)}
                                    className="w-full p-6 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-black dark:text-white rounded-lg"
                                    rows={8} // Smaller text area for titles
                                ></textarea>
                                <button
                                    onClick={() => handleCopy(mergedTitles, 0, "content")}
                                    className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
                                    title="Copy Merged Titles"
                                >
                                    {copiedStatus[0]?.content ? (
                                        <FaCheck className="w-5 h-5" />
                                    ) : (
                                        <FaRegCopy className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Loading and Error Handling */}
                    {isLoading && (
                        <div className="flex flex-col items-center justify-center mt-8">
                            <FadeLoader
                                color="#000000"
                                height={11.5}
                                width={4}
                                radius={5}
                                margin={-2}
                                speedMultiplier={1.2}
                            />
                            <p className="mt-4 text-lg font-medium text-black dark:text-white">
                                {progressMessage}
                            </p>
                        </div>
                    )}
                    {error && <p className="text-red-500 mt-6 text-center">{error}</p>}
                </div>
                <style jsx>{`
    @keyframes fadeSlideInOut {
        0% {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
        }
        10% {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
        90% {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
        100% {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
        }
    }

    .fade-slide-in-out {
        animation: fadeSlideInOut 3s forwards;
    }

    .stop-button-container {
        opacity: 0;
        transform: scale(0.95);
        transition: opacity 0.3s ease, transform 0.3s ease;
    }

    .stop-button-container.show {
        opacity: 1;
        transform: scale(1);
    }

    .stop-button-container.hide {
        opacity: 0;
        transform: scale(0.95);
    }
`}</style>
            </div>
        </>

    );
};

export default Page;
