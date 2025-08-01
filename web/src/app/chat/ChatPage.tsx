"use client";

import { FiChevronDown, FiChevronUp } from "react-icons/fi";
import { format } from "date-fns";
import { DatePicker } from '@mui/x-date-pickers';
import { TextFieldProps } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { Box, TextField } from '@mui/material';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { IoMdClose } from "react-icons/io";
import {
  redirect,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  BackendChatSession,
  BackendMessage,
  ChatFileType,
  ChatSession,
  ChatSessionSharedStatus,
  FileDescriptor,
  FileChatDisplay,
  Message,
  MessageResponseIDInfo,
  RetrievalType,
  StreamingError,
  ToolCallMetadata,
  SubQuestionDetail,
  constructSubQuestions,
  DocumentsResponse,
  AgenticMessageResponseIDInfo,
  UserKnowledgeFilePacket,
} from "./interfaces";

import Prism from "prismjs";
import Cookies from "js-cookie";
import { HistorySidebar } from "./sessionSidebar/HistorySidebar";
import { Persona } from "../admin/assistants/interfaces";
import { HealthCheckBanner } from "@/components/health/healthcheck";
import {
  buildChatUrl,
  buildLatestMessageChain,
  createChatSession,
  getCitedDocumentsFromMessage,
  getHumanAndAIMessageFromMessageNumber,
  getLastSuccessfulMessageId,
  handleChatFeedback,
  nameChatSession,
  PacketType,
  personaIncludesRetrieval,
  processRawChatHistory,
  removeMessage,
  sendMessage,
  SendMessageParams,
  setMessageAsLatest,
  updateLlmOverrideForChatSession,
  updateParentChildren,
  uploadFilesForChat,
  useScrollonStream,
} from "./lib";
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePopup } from "@/components/admin/connectors/Popup";
import { SEARCH_PARAM_NAMES, shouldSubmitOnLoad } from "./searchParams";
import { LlmDescriptor, useFilters, useLlmManager } from "@/lib/hooks";
import { ChatState, FeedbackType, RegenerationState } from "./types";
import { DocumentResults } from "./documentSidebar/DocumentResults";
import { OnyxInitializingLoader } from "@/components/OnyxInitializingLoader";
import { FeedbackModal } from "./modal/FeedbackModal";
import { ShareChatSessionModal } from "./modal/ShareChatSessionModal";
import { FiArrowDown } from "react-icons/fi";
import { ChatIntro } from "./ChatIntro";
import { AIMessage, HumanMessage } from "./message/Messages";
import { StarterMessages } from "../../components/assistants/StarterMessage";
import {
  AnswerPiecePacket,
  OnyxDocument,
  DocumentInfoPacket,
  StreamStopInfo,
  StreamStopReason,
  SubQueryPiece,
  SubQuestionPiece,
  AgentAnswerPiece,
  RefinedAnswerImprovement,
  MinimalOnyxDocument,
} from "@/lib/search/interfaces";
import { buildFilters } from "@/lib/search/utils";
import { SettingsContext } from "@/components/settings/SettingsProvider";
import Dropzone from "react-dropzone";
import {
  getFinalLLM,
  modelSupportsImageInput,
  structureValue,
} from "@/lib/llm/utils";
import { ChatInputBar } from "./input/ChatInputBar";
import { useChatContext } from "@/components/context/ChatContext";
import { ChatPopup } from "./ChatPopup";
import FunctionalHeader from "@/components/chat/Header";
import { useSidebarVisibility } from "@/components/chat/hooks";
import {
  PRO_SEARCH_TOGGLED_COOKIE_NAME,
  SIDEBAR_TOGGLED_COOKIE_NAME,
} from "@/components/resizable/constants";
import FixedLogo from "@/components/logo/FixedLogo";
import ExceptionTraceModal from "@/components/modals/ExceptionTraceModal";
import { SEARCH_TOOL_ID, SEARCH_TOOL_NAME } from "./tools/constants";
import { useUser } from "@/components/user/UserProvider";
import { ApiKeyModal } from "@/components/llm/ApiKeyModal";
import BlurBackground from "../../components/chat/BlurBackground";
import { NoAssistantModal } from "@/components/modals/NoAssistantModal";
import { useAssistants } from "@/components/context/AssistantsContext";
import TextView from "@/components/chat/TextView";
import { Modal } from "@/components/Modal";
import { useSendMessageToParent } from "@/lib/extension/utils";
import {
  CHROME_MESSAGE,
  SUBMIT_MESSAGE_TYPES,
} from "@/lib/extension/constants";

import { getSourceMetadata } from "@/lib/sources";
import { UserSettingsModal } from "./modal/UserSettingsModal";
import { AgenticMessage } from "./message/AgenticMessage";
import AssistantModal from "../assistants/mine/AssistantModal";
import { useSidebarShortcut } from "@/lib/browserUtilities";
import { FilePickerModal } from "./my-documents/components/FilePicker";

import { SourceMetadata } from "@/lib/search/interfaces";
import { ValidSources } from "@/lib/types";
import {
  FileResponse,
  FolderResponse,
  useDocumentsContext,
} from "./my-documents/DocumentsContext";
import { ChatSearchModal } from "./chat_search/ChatSearchModal";
import { ErrorBanner } from "./message/Resubmit";
import MinimalMarkdown from "@/components/chat/MinimalMarkdown";
import GaugeMeter from "@/components/GaugeMeter";

const TEMP_USER_MESSAGE_ID = -1;
const TEMP_ASSISTANT_MESSAGE_ID = -2;
const SYSTEM_MESSAGE_ID = -3;

export enum UploadIntent {
  ATTACH_TO_MESSAGE, // For files uploaded via ChatInputBar (paste, drag/drop)
  ADD_TO_DOCUMENTS, // For files uploaded via FilePickerModal or similar (just add to repo)
}

export function ChatPage({
  toggle,
  documentSidebarInitialWidth,
  sidebarVisible,
  firstMessage,
  initialFolders,
  initialFiles,
}: {
  toggle: (toggled?: boolean) => void;
  documentSidebarInitialWidth?: number;
  sidebarVisible: boolean;
  firstMessage?: string;
  initialFolders?: any;
  initialFiles?: any;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    chatSessions,
    ccPairs,
    tags,
    documentSets,
    llmProviders,
    folders,
    shouldShowWelcomeModal,
    refreshChatSessions,
    proSearchToggled,
  } = useChatContext();

  const {
    selectedFiles,
    selectedFolders,
    addSelectedFile,
    addSelectedFolder,
    clearSelectedItems,
    folders: userFolders,
    files: allUserFiles,
    uploadFile,
    currentMessageFiles,
    setCurrentMessageFiles,
  } = useDocumentsContext();

  const defaultAssistantIdRaw = searchParams?.get(
    SEARCH_PARAM_NAMES.PERSONA_ID
  );
  const defaultAssistantId = defaultAssistantIdRaw
    ? parseInt(defaultAssistantIdRaw)
    : undefined;

  // Function declarations need to be outside of blocks in strict mode
  function useScreenSize() {
    const [screenSize, setScreenSize] = useState({
      width: typeof window !== "undefined" ? window.innerWidth : 0,
      height: typeof window !== "undefined" ? window.innerHeight : 0,
    });

    useEffect(() => {
      const handleResize = () => {
        setScreenSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, []);

    return screenSize;
  }

  // handle redirect if chat page is disabled
  // NOTE: this must be done here, in a client component since
  // settings are passed in via Context and therefore aren't
  // available in server-side components
  const settings = useContext(SettingsContext);
  const enterpriseSettings = settings?.enterpriseSettings;
  const clearSelectedDocuments = () => {
    setSelectedDocuments([]);
    setSelectedDocumentTokens(0);
    clearSelectedItems();
  };

  const toggleDocumentSelection = (document: OnyxDocument) => {
    setSelectedDocuments((prev) =>
      prev.some((d) => d.document_id === document.document_id)
        ? prev.filter((d) => d.document_id !== document.document_id)
        : [...prev, document]
    );
  };

  const [gaugeSize, setGaugeSize] = useState(calculateGaugeSize());

  function calculateGaugeSize() {
    const width = window.innerWidth;
    if (width < 640) return 112; // Small screens (w-28 = 112px)
    if (width < 768) return 144; // Medium screens (w-36 = 144px)
    return Math.min(144, width * 0.1); // Scale up to 10% of viewport width, capped at 144px
  }

  useEffect(() => {
    const handleResize = () => {
      setGaugeSize(calculateGaugeSize());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [caseAnalysisConfidence, setCaseAnalysisConfidence] = useState<number | null>(null);
  const [hasCaseAnalysisStarted, setHasCaseAnalysisStarted] = useState(false);
  const [caseAnalysisReasoning, setCaseAnalysisReasoning] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<
    { id: string; query: string; results: any[] }[]
  >([]);

  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [toggleDocSelection, setToggleDocSelection] = useState(false);
  const [documentSidebarVisible, setDocumentSidebarVisible] = useState(false);
  const [proSearchEnabled, setProSearchEnabled] = useState(proSearchToggled);
  const [showPopup, setShowPopup] = useState(false);
  const [showDatePopup, setShowDatePopup] = useState(false);
  const [showAdvancedOption, setShowAdvancedOption] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [judgeName, setJudgeName] = useState('');
  const [caseName, setCaseName] = useState('');
  const [state, setState] = useState<{
    startDate: Date | null;
    endDate: Date | null;
    key: string;
  }[]>([
    { startDate: null, endDate: null, key: 'selection' }
  ]);

  const toggleDatePopup = () => setShowDatePopup(prev => !prev);

  const addKeyword = () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;

    if (keywords.includes(trimmed)) {
      toast.warning(`"${trimmed}" is already added.`);
      return;
    }

    setKeywords(prev => [...prev, trimmed]);
    setNewKeyword('');
  };

  const removeKeyword = (kw: string) => {
    setKeywords(prev => prev.filter(k => k !== kw));
  };

  const applyConfiguration = async () => {
    console.log('Applying configuration:', {
      keywords,
      judgeName,
      caseName,
      dateRange: state,
    });

    setShowPopup(false);

    if (!selectedQueryId) {
      setPopup({
        type: "warning",
        message: "Please select a query to refine.",
      });
      return;
    }

    const selectedQuery = searchHistory.find(q => q.id === selectedQueryId);
    if (!selectedQuery) {
      setPopup({
        type: "warning",
        message: "Selected query not found.",
      });
      return;
    }

    let filteredResults = [...selectedQuery.results];

    // Require that at least one refine/advanced search field is filled
    const noKeywords = keywords.length === 0;
    const noJudgeName = !judgeName.trim();
    const noCaseName = !caseName.trim();
    const noDateRange = !(state[0]?.startDate && state[0]?.endDate);

    if (noKeywords && noJudgeName && noCaseName && noDateRange) {
      setPopup({
        type: "warning",
        message: "Kindly fill in either the \"Refine by keywords\" field or at least one of the Advanced Search fields before applying the filters.",
      });
      return;
    }

    try {
      let filteredResults = [...selectedQuery.results];

      if (keywords.length > 0) {
        const refineResponse = await fetch("/api/legacysearch/refine_search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            results: filteredResults,
            keyword: keywords.join(","),
          }),
        });

        if (!refineResponse.ok) throw new Error("Refine search failed");

        const refined = await refineResponse.json();
        filteredResults = refined.results;
      }

      if (judgeName || caseName || (state[0]?.startDate && state[0]?.endDate)) {
        const filterResponse = await fetch("/api/legacysearch/advanced_filter", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            results: filteredResults,
            judge_name: judgeName || null,
            case_title: caseName || null,
            start_date: state[0]?.startDate ? state[0].startDate.toISOString().split("T")[0] : null,
            end_date: state[0]?.endDate ? state[0].endDate.toISOString().split("T")[0] : null,
          }),
        });

        if (!filterResponse.ok) throw new Error("Advanced filter failed");

        const filtered = await filterResponse.json();
        filteredResults = filtered.results;
        setSearchHistory(prev =>
          prev.map(q =>
            q.id === selectedQueryId ? { ...q, results: filteredResults } : q
          )
        );
      }

      const appliedRefine = keywords.length > 0;
      const appliedAdvanced = !!judgeName || !!caseName || (state[0]?.startDate && state[0]?.endDate);

      // Default label = original query text
      let searchLabel = selectedQuery.query;

      if (appliedRefine && appliedAdvanced) {
        searchLabel += " / refined & advanced search";
      } else if (appliedRefine) {
        searchLabel += " / refined search";
      } else if (appliedAdvanced) {
        searchLabel += " / advanced search";
      }

      const newMessageId = Date.now();

      const userMessage: Message = {
        messageId: newMessageId - 1,
        message: searchLabel,
        type: "user",
        files: [],
        toolCall: null,
        parentMessageId: SYSTEM_MESSAGE_ID,
      };

      const assistantMessage: Message = {
        messageId: newMessageId,
        message:
          `**Found ${filteredResults.length} results.**\n\n` +
          filteredResults
            .map((r: any, i: number) => {
              const formattedText =
                (r.all_text || "No content available.")
                  .split("\n")
                  .map((line: string) => `> ${line}`)
                  .join("\n");

              const caseTitle = String(r.case_title || "Untitled");

              let messageBlock =
                `> **${i + 1}. Case Title:** ${caseTitle}\n` +
                `> \n` +
                `> **Judge's Name:** ${r.judges_name || "Unknown"}\n` +
                `> \n` +
                `> **Date of Judgement:** ${r.date_of_judgment || "N/A"}\n` +
                `>\n${formattedText}`;

              messageBlock = messageBlock.replace(/^"(.*)"$/, "$1"); // Remove outer quotes if everything is wrapped

              return messageBlock;
            })
            .join(`\n\n---\n\n`),
        type: "assistant",
        files: [],
        toolCall: null,
        parentMessageId: userMessage.messageId,
      };

      upsertToCompleteMessageMap({
        messages: [userMessage, assistantMessage],
        chatSessionId: currentSessionId(),
      });

      await setMessageAsLatest(assistantMessage.messageId);
      updateChatState("input");
      resetRegenerationState();
    } catch (error) {
      console.error("Refine/Filter Search Error:", error);
      updateChatState("input");
      setPopup({
        type: "error",
        message: "Search filter or refine failed.",
      });
    }
  };

  const toggleProSearch = () => {
    Cookies.set(
      PRO_SEARCH_TOGGLED_COOKIE_NAME,
      String(!proSearchEnabled).toLocaleLowerCase()
    );
    setProSearchEnabled(!proSearchEnabled);
  };

  const isInitialLoad = useRef(true);
  const [userSettingsToggled, setUserSettingsToggled] = useState(false);

  const { assistants: availableAssistants, pinnedAssistants } = useAssistants();

  const [showApiKeyModal, setShowApiKeyModal] = useState(
    !shouldShowWelcomeModal
  );

  const { user, isAdmin } = useUser();
  const slackChatId = searchParams?.get("slackChatId");
  const existingChatIdRaw = searchParams?.get("chatId");

  const [showHistorySidebar, setShowHistorySidebar] = useState(false);

  const existingChatSessionId = existingChatIdRaw ? existingChatIdRaw : null;

  const selectedChatSession = chatSessions.find(
    (chatSession) => chatSession.id === existingChatSessionId
  );

  useEffect(() => {
    if (user?.is_anonymous_user) {
      Cookies.set(
        SIDEBAR_TOGGLED_COOKIE_NAME,
        String(!sidebarVisible).toLocaleLowerCase()
      );
      toggle(false);
    }
  }, [user]);

  const processSearchParamsAndSubmitMessage = (searchParamsString: string) => {
    const newSearchParams = new URLSearchParams(searchParamsString);
    const message = newSearchParams?.get("user-prompt");

    filterManager.buildFiltersFromQueryString(
      newSearchParams.toString(),
      availableSources,
      documentSets.map((ds) => ds.name),
      tags
    );

    const fileDescriptorString = newSearchParams?.get(SEARCH_PARAM_NAMES.FILES);
    const overrideFileDescriptors: FileDescriptor[] = fileDescriptorString
      ? JSON.parse(decodeURIComponent(fileDescriptorString))
      : [];

    newSearchParams.delete(SEARCH_PARAM_NAMES.SEND_ON_LOAD);

    router.replace(`?${newSearchParams.toString()}`, { scroll: false });

    // If there's a message, submit it
    if (message) {
      setSubmittedMessage(message);
      onSubmit({ messageOverride: message, overrideFileDescriptors });
    }
  };

  const chatSessionIdRef = useRef<string | null>(existingChatSessionId);

  // Only updates on session load (ie. rename / switching chat session)
  // Useful for determining which session has been loaded (i.e. still on `new, empty session` or `previous session`)
  const loadedIdSessionRef = useRef<string | null>(existingChatSessionId);

  const existingChatSessionAssistantId = selectedChatSession?.persona_id;
  const [selectedAssistant, setSelectedAssistant] = useState<
    Persona | undefined
  >(
    // NOTE: look through available assistants here, so that even if the user
    // has hidden this assistant it still shows the correct assistant when
    // going back to an old chat session
    existingChatSessionAssistantId !== undefined
      ? availableAssistants.find(
        (assistant) => assistant.id === existingChatSessionAssistantId
      )
      : defaultAssistantId !== undefined
        ? availableAssistants.find(
          (assistant) => assistant.id === defaultAssistantId
        )
        : undefined
  );
  // Gather default temperature settings
  const search_param_temperature = searchParams?.get(
    SEARCH_PARAM_NAMES.TEMPERATURE
  );

  const setSelectedAssistantFromId = (assistantId: number) => {
    // NOTE: also intentionally look through available assistants here, so that
    // even if the user has hidden an assistant they can still go back to it
    // for old chats
    setSelectedAssistant(
      availableAssistants.find((assistant) => assistant.id === assistantId)
    );
  };

  const [alternativeAssistant, setAlternativeAssistant] =
    useState<Persona | null>(null);

  const [presentingDocument, setPresentingDocument] =
    useState<MinimalOnyxDocument | null>(null);

  // Current assistant is decided based on this ordering
  // 1. Alternative assistant (assistant selected explicitly by user)
  // 2. Selected assistant (assistnat default in this chat session)
  // 3. First pinned assistants (ordered list of pinned assistants)
  // 4. Available assistants (ordered list of available assistants)
  // Relevant test: `live_assistant.spec.ts`
  const liveAssistant: Persona | undefined = useMemo(
    () =>
      alternativeAssistant ||
      selectedAssistant ||
      pinnedAssistants[0] ||
      availableAssistants[0],
    [
      alternativeAssistant,
      selectedAssistant,
      pinnedAssistants,
      availableAssistants,
    ]
  );

  const llmManager = useLlmManager(
    llmProviders,
    selectedChatSession,
    liveAssistant
  );

  const noAssistants = liveAssistant == null || liveAssistant == undefined;

  const availableSources: ValidSources[] = useMemo(() => {
    return ccPairs.map((ccPair) => ccPair.source);
  }, [ccPairs]);

  const sources: SourceMetadata[] = useMemo(() => {
    const uniqueSources = Array.from(new Set(availableSources));
    return uniqueSources.map((source) => getSourceMetadata(source));
  }, [availableSources]);

  const stopGenerating = () => {
    const currentSession = currentSessionId();
    const controller = abortControllers.get(currentSession);
    if (controller) {
      controller.abort();
      setAbortControllers((prev) => {
        const newControllers = new Map(prev);
        newControllers.delete(currentSession);
        return newControllers;
      });
    }

    const lastMessage = messageHistory[messageHistory.length - 1];
    if (
      lastMessage &&
      lastMessage.type === "assistant" &&
      lastMessage.toolCall &&
      lastMessage.toolCall.tool_result === undefined
    ) {
      const newCompleteMessageMap = new Map(
        currentMessageMap(completeMessageDetail)
      );
      const updatedMessage = { ...lastMessage, toolCall: null };
      newCompleteMessageMap.set(lastMessage.messageId, updatedMessage);
      updateCompleteMessageDetail(currentSession, newCompleteMessageMap);
    }

    updateChatState("input", currentSession);
  };

  // this is for "@"ing assistants

  // this is used to track which assistant is being used to generate the current message
  // for example, this would come into play when:
  // 1. default assistant is `Onyx`
  // 2. we "@"ed the `GPT` assistant and sent a message
  // 3. while the `GPT` assistant message is generating, we "@" the `Paraphrase` assistant
  const [alternativeGeneratingAssistant, setAlternativeGeneratingAssistant] =
    useState<Persona | null>(null);

  // used to track whether or not the initial "submit on load" has been performed
  // this only applies if `?submit-on-load=true` or `?submit-on-load=1` is in the URL
  // NOTE: this is required due to React strict mode, where all `useEffect` hooks
  // are run twice on initial load during development
  const submitOnLoadPerformed = useRef<boolean>(false);

  const { popup, setPopup } = usePopup();

  // fetch messages for the chat session
  const [isFetchingChatMessages, setIsFetchingChatMessages] = useState(
    existingChatSessionId !== null
  );

  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    Prism.highlightAll();
    setIsReady(true);
  }, []);

  useEffect(() => {
    const priorChatSessionId = chatSessionIdRef.current;
    const loadedSessionId = loadedIdSessionRef.current;
    chatSessionIdRef.current = existingChatSessionId;
    loadedIdSessionRef.current = existingChatSessionId;

    textAreaRef.current?.focus();

    // only clear things if we're going from one chat session to another
    const isChatSessionSwitch = existingChatSessionId !== priorChatSessionId;
    if (isChatSessionSwitch) {
      // de-select documents

      // reset all filters
      filterManager.setSelectedDocumentSets([]);
      filterManager.setSelectedSources([]);
      filterManager.setSelectedTags([]);
      filterManager.setTimeRange(null);

      // remove uploaded files
      setCurrentMessageFiles([]);

      // if switching from one chat to another, then need to scroll again
      // if we're creating a brand new chat, then don't need to scroll
      if (chatSessionIdRef.current !== null) {
        clearSelectedDocuments();
        setHasPerformedInitialScroll(false);
      }
    }

    async function initialSessionFetch() {
      if (existingChatSessionId === null) {
        setIsFetchingChatMessages(false);
        if (defaultAssistantId !== undefined) {
          setSelectedAssistantFromId(defaultAssistantId);
        } else {
          setSelectedAssistant(undefined);
        }
        updateCompleteMessageDetail(null, new Map());
        setChatSessionSharedStatus(ChatSessionSharedStatus.Private);

        // if we're supposed to submit on initial load, then do that here
        if (
          shouldSubmitOnLoad(searchParams) &&
          !submitOnLoadPerformed.current
        ) {
          submitOnLoadPerformed.current = true;
          await onSubmit();
        }
        return;
      }

      setIsFetchingChatMessages(true);
      const response = await fetch(
        `/api/chat/get-chat-session/${existingChatSessionId}`
      );

      const session = await response.json();
      const chatSession = session as BackendChatSession;
      setSelectedAssistantFromId(chatSession.persona_id);

      const newMessageMap = processRawChatHistory(chatSession.messages);
      const newMessageHistory = buildLatestMessageChain(newMessageMap);

      // Update message history except for edge where where
      // last message is an error and we're on a new chat.
      // This corresponds to a "renaming" of chat, which occurs after first message
      // stream
      if (
        (messageHistory[messageHistory.length - 1]?.type !== "error" ||
          loadedSessionId != null) &&
        !currentChatAnswering()
      ) {
        const latestMessageId =
          newMessageHistory[newMessageHistory.length - 1]?.messageId;

        setSelectedMessageForDocDisplay(
          latestMessageId !== undefined ? latestMessageId : null
        );

        updateCompleteMessageDetail(chatSession.chat_session_id, newMessageMap);
      }

      setChatSessionSharedStatus(chatSession.shared_status);

      // go to bottom. If initial load, then do a scroll,
      // otherwise just appear at the bottom

      scrollInitialized.current = false;

      if (!hasPerformedInitialScroll) {
        if (isInitialLoad.current) {
          setHasPerformedInitialScroll(true);
          isInitialLoad.current = false;
        }
        clientScrollToBottom();

        setTimeout(() => {
          setHasPerformedInitialScroll(true);
        }, 100);
      } else if (isChatSessionSwitch) {
        setHasPerformedInitialScroll(true);
        clientScrollToBottom(true);
      }

      setIsFetchingChatMessages(false);

      // if this is a seeded chat, then kick off the AI message generation
      if (
        newMessageHistory.length === 1 &&
        !submitOnLoadPerformed.current &&
        searchParams?.get(SEARCH_PARAM_NAMES.SEEDED) === "true"
      ) {
        submitOnLoadPerformed.current = true;
        const seededMessage = newMessageHistory[0].message;
        await onSubmit({
          isSeededChat: true,
          messageOverride: seededMessage,
        });
        // force re-name if the chat session doesn't have one
        if (!chatSession.description) {
          await nameChatSession(existingChatSessionId);
          refreshChatSessions();
        }
      } else if (newMessageHistory.length === 2 && !chatSession.description) {
        await nameChatSession(existingChatSessionId);
        refreshChatSessions();
      }
    }

    initialSessionFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingChatSessionId, searchParams?.get(SEARCH_PARAM_NAMES.PERSONA_ID)]);

  useEffect(() => {
    const userFolderId = searchParams?.get(SEARCH_PARAM_NAMES.USER_FOLDER_ID);
    const allMyDocuments = searchParams?.get(
      SEARCH_PARAM_NAMES.ALL_MY_DOCUMENTS
    );

    if (userFolderId) {
      const userFolder = userFolders.find(
        (folder) => folder.id === parseInt(userFolderId)
      );
      if (userFolder) {
        addSelectedFolder(userFolder);
      }
    } else if (allMyDocuments === "true" || allMyDocuments === "1") {
      // Clear any previously selected folders

      clearSelectedItems();

      // Add all user folders to the current context
      userFolders.forEach((folder) => {
        addSelectedFolder(folder);
      });
    }
  }, [
    userFolders,
    searchParams?.get(SEARCH_PARAM_NAMES.USER_FOLDER_ID),
    searchParams?.get(SEARCH_PARAM_NAMES.ALL_MY_DOCUMENTS),
    addSelectedFolder,
    clearSelectedItems,
  ]);

  const [message, setMessage] = useState(
    searchParams?.get(SEARCH_PARAM_NAMES.USER_PROMPT) || ""
  );

  const [completeMessageDetail, setCompleteMessageDetail] = useState<
    Map<string | null, Map<number, Message>>
  >(new Map());

  const updateCompleteMessageDetail = (
    sessionId: string | null,
    messageMap: Map<number, Message>
  ) => {
    setCompleteMessageDetail((prevState) => {
      const newState = new Map(prevState);
      newState.set(sessionId, messageMap);
      return newState;
    });
  };

  const currentMessageMap = (
    messageDetail: Map<string | null, Map<number, Message>>
  ) => {
    return (
      messageDetail.get(chatSessionIdRef.current) || new Map<number, Message>()
    );
  };
  const currentSessionId = (): string => {
    return chatSessionIdRef.current!;
  };

  const upsertToCompleteMessageMap = ({
    messages,
    completeMessageMapOverride,
    chatSessionId,
    replacementsMap = null,
    makeLatestChildMessage = false,
  }: {
    messages: Message[];
    // if calling this function repeatedly with short delay, stay may not update in time
    // and result in weird behavior
    completeMessageMapOverride?: Map<number, Message> | null;
    chatSessionId?: string;
    replacementsMap?: Map<number, number> | null;
    makeLatestChildMessage?: boolean;
  }) => {
    // deep copy
    const frozenCompleteMessageMap =
      completeMessageMapOverride || currentMessageMap(completeMessageDetail);
    const newCompleteMessageMap = structuredClone(frozenCompleteMessageMap);

    if (newCompleteMessageMap.size === 0) {
      const systemMessageId = messages[0].parentMessageId || SYSTEM_MESSAGE_ID;
      const firstMessageId = messages[0].messageId;
      const dummySystemMessage: Message = {
        messageId: systemMessageId,
        message: "",
        type: "system",
        files: [],
        toolCall: null,
        parentMessageId: null,
        childrenMessageIds: [firstMessageId],
        latestChildMessageId: firstMessageId,
      };
      newCompleteMessageMap.set(
        dummySystemMessage.messageId,
        dummySystemMessage
      );
      messages[0].parentMessageId = systemMessageId;
    }

    messages.forEach((message) => {
      const idToReplace = replacementsMap?.get(message.messageId);
      if (idToReplace) {
        removeMessage(idToReplace, newCompleteMessageMap);
      }

      // update childrenMessageIds for the parent
      if (
        !newCompleteMessageMap.has(message.messageId) &&
        message.parentMessageId !== null
      ) {
        updateParentChildren(message, newCompleteMessageMap, true);
      }
      newCompleteMessageMap.set(message.messageId, message);
    });
    // if specified, make these new message the latest of the current message chain
    if (makeLatestChildMessage) {
      const currentMessageChain = buildLatestMessageChain(
        frozenCompleteMessageMap
      );
      const latestMessage = currentMessageChain[currentMessageChain.length - 1];
      if (latestMessage) {
        newCompleteMessageMap.get(
          latestMessage.messageId
        )!.latestChildMessageId = messages[0].messageId;
      }
    }

    const newCompleteMessageDetail = {
      sessionId: chatSessionId || currentSessionId(),
      messageMap: newCompleteMessageMap,
    };

    updateCompleteMessageDetail(
      chatSessionId || currentSessionId(),
      newCompleteMessageMap
    );
    console.log(newCompleteMessageDetail);
    return newCompleteMessageDetail;
  };

  const messageHistory = buildLatestMessageChain(
    currentMessageMap(completeMessageDetail)
  );

  const [submittedMessage, setSubmittedMessage] = useState(firstMessage || "");

  const [chatState, setChatState] = useState<Map<string | null, ChatState>>(
    new Map([[chatSessionIdRef.current, firstMessage ? "loading" : "input"]])
  );

  const [regenerationState, setRegenerationState] = useState<
    Map<string | null, RegenerationState | null>
  >(new Map([[null, null]]));

  useEffect(() => {
    // Reset state when switching assistants
    updateChatState("input");
    resetRegenerationState(currentSessionId());
    setAlternativeGeneratingAssistant(null);
    setSubmittedMessage("");
    setAgenticGenerating(false);
    setSelectedMessageForDocDisplay(null);

    // Only reset GaugeMeter if the assistant is NOT Case Analysis
    if (liveAssistant?.name !== "Case Analysis") {
      setCaseAnalysisConfidence(null);
      setCaseAnalysisReasoning(null);
      setHasCaseAnalysisStarted(false);
    }

    clientScrollToBottom(true);
  }, [liveAssistant?.id]);

  const [abortControllers, setAbortControllers] = useState<
    Map<string | null, AbortController>
  >(new Map());

  // Updates "null" session values to new session id for
  // regeneration, chat, and abort controller state, messagehistory
  const updateStatesWithNewSessionId = (newSessionId: string) => {
    const updateState = (
      setState: Dispatch<SetStateAction<Map<string | null, any>>>,
      defaultValue?: any
    ) => {
      setState((prevState) => {
        const newState = new Map(prevState);
        const existingState = newState.get(null);
        if (existingState !== undefined) {
          newState.set(newSessionId, existingState);
          newState.delete(null);
        } else if (defaultValue !== undefined) {
          newState.set(newSessionId, defaultValue);
        }
        return newState;
      });
    };

    updateState(setRegenerationState);
    updateState(setChatState);
    updateState(setAbortControllers);

    // Update completeMessageDetail
    setCompleteMessageDetail((prevState) => {
      const newState = new Map(prevState);
      const existingMessages = newState.get(null);
      if (existingMessages) {
        newState.set(newSessionId, existingMessages);
        newState.delete(null);
      }
      return newState;
    });

    // Update chatSessionIdRef
    chatSessionIdRef.current = newSessionId;
  };

  const updateChatState = (newState: ChatState, sessionId?: string | null) => {
    setChatState((prevState) => {
      const newChatState = new Map(prevState);
      newChatState.set(
        sessionId !== undefined ? sessionId : currentSessionId(),
        newState
      );
      return newChatState;
    });
  };

  const currentChatState = (): ChatState => {
    return chatState.get(currentSessionId()) || "input";
  };

  const currentChatAnswering = () => {
    return (
      currentChatState() == "toolBuilding" ||
      currentChatState() == "streaming" ||
      currentChatState() == "loading"
    );
  };

  const updateRegenerationState = (
    newState: RegenerationState | null,
    sessionId?: string | null
  ) => {
    const newRegenerationState = new Map(regenerationState);
    newRegenerationState.set(
      sessionId !== undefined && sessionId != null
        ? sessionId
        : currentSessionId(),
      newState
    );

    setRegenerationState((prevState) => {
      const newRegenerationState = new Map(prevState);
      newRegenerationState.set(
        sessionId !== undefined && sessionId != null
          ? sessionId
          : currentSessionId(),
        newState
      );
      return newRegenerationState;
    });
  };

  const resetRegenerationState = (sessionId?: string | null) => {
    updateRegenerationState(null, sessionId);
  };

  const currentRegenerationState = (): RegenerationState | null => {
    return regenerationState.get(currentSessionId()) || null;
  };

  const [canContinue, setCanContinue] = useState<Map<string | null, boolean>>(
    new Map([[null, false]])
  );

  const updateCanContinue = (newState: boolean, sessionId?: string | null) => {
    setCanContinue((prevState) => {
      const newCanContinueState = new Map(prevState);
      newCanContinueState.set(
        sessionId !== undefined ? sessionId : currentSessionId(),
        newState
      );
      return newCanContinueState;
    });
  };

  const currentCanContinue = (): boolean => {
    return canContinue.get(currentSessionId()) || false;
  };

  const currentSessionChatState = currentChatState();
  const currentSessionRegenerationState = currentRegenerationState();

  // for document display
  // NOTE: -1 is a special designation that means the latest AI message
  const [selectedMessageForDocDisplay, setSelectedMessageForDocDisplay] =
    useState<number | null>(null);

  const { aiMessage, humanMessage } = selectedMessageForDocDisplay
    ? getHumanAndAIMessageFromMessageNumber(
      messageHistory,
      selectedMessageForDocDisplay
    )
    : { aiMessage: null, humanMessage: null };

  const [chatSessionSharedStatus, setChatSessionSharedStatus] =
    useState<ChatSessionSharedStatus>(ChatSessionSharedStatus.Private);

  useEffect(() => {
    if (messageHistory.length === 0 && chatSessionIdRef.current === null) {
      // Select from available assistants so shared assistants appear.
      setSelectedAssistant(
        availableAssistants.find((persona) => persona.id === defaultAssistantId)
      );
    }
  }, [defaultAssistantId, availableAssistants, messageHistory.length]);

  useEffect(() => {
    if (
      submittedMessage &&
      currentSessionChatState === "loading" &&
      messageHistory.length == 0
    ) {
      window.parent.postMessage(
        { type: CHROME_MESSAGE.LOAD_NEW_CHAT_PAGE },
        "*"
      );
    }
  }, [submittedMessage, currentSessionChatState]);
  // just choose a conservative default, this will be updated in the
  // background on initial load / on persona change
  const [maxTokens, setMaxTokens] = useState<number>(4096);

  // fetch # of allowed document tokens for the selected Persona
  useEffect(() => {
    async function fetchMaxTokens() {
      const response = await fetch(
        `/api/chat/max-selected-document-tokens?persona_id=${liveAssistant?.id}`
      );
      if (response.ok) {
        const maxTokens = (await response.json()).max_tokens as number;
        setMaxTokens(maxTokens);
      }
    }
    fetchMaxTokens();
  }, [liveAssistant]);

  const filterManager = useFilters();
  const [isChatSearchModalOpen, setIsChatSearchModalOpen] = useState(false);

  const [currentFeedback, setCurrentFeedback] = useState<
    [FeedbackType, number] | null
  >(null);

  const [sharingModalVisible, setSharingModalVisible] =
    useState<boolean>(false);

  const [aboveHorizon, setAboveHorizon] = useState(false);

  const scrollableDivRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const endDivRef = useRef<HTMLDivElement>(null);
  const endPaddingRef = useRef<HTMLDivElement>(null);

  const previousHeight = useRef<number>(
    inputRef.current?.getBoundingClientRect().height!
  );
  const scrollDist = useRef<number>(0);

  const handleInputResize = () => {
    setTimeout(() => {
      if (
        inputRef.current &&
        lastMessageRef.current &&
        !waitForScrollRef.current
      ) {
        const newHeight: number =
          inputRef.current?.getBoundingClientRect().height!;
        const heightDifference = newHeight - previousHeight.current;
        if (
          previousHeight.current &&
          heightDifference != 0 &&
          endPaddingRef.current &&
          scrollableDivRef &&
          scrollableDivRef.current
        ) {
          endPaddingRef.current.style.transition = "height 0.3s ease-out";
          endPaddingRef.current.style.height = `${Math.max(
            newHeight - 50,
            0
          )}px`;

          if (autoScrollEnabled) {
            scrollableDivRef?.current.scrollBy({
              left: 0,
              top: Math.max(heightDifference, 0),
              behavior: "smooth",
            });
          }
        }
        previousHeight.current = newHeight;
      }
    }, 100);
  };

  const clientScrollToBottom = (fast?: boolean) => {
    waitForScrollRef.current = true;

    setTimeout(() => {
      if (!endDivRef.current || !scrollableDivRef.current) {
        console.error("endDivRef or scrollableDivRef not found");
        return;
      }

      const rect = endDivRef.current.getBoundingClientRect();
      const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

      if (isVisible) return;

      // Check if all messages are currently rendered
      // If all messages are already rendered, scroll immediately
      endDivRef.current.scrollIntoView({
        behavior: fast ? "auto" : "smooth",
      });

      setHasPerformedInitialScroll(true);
    }, 50);

    // Reset waitForScrollRef after 1.5 seconds
    setTimeout(() => {
      waitForScrollRef.current = false;
    }, 1500);
  };

  const debounceNumber = 100; // time for debouncing

  const [hasPerformedInitialScroll, setHasPerformedInitialScroll] = useState(
    existingChatSessionId === null
  );

  // handle re-sizing of the text area
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    handleInputResize();
  }, [message]);

  // used for resizing of the document sidebar
  const masterFlexboxRef = useRef<HTMLDivElement>(null);
  const [maxDocumentSidebarWidth, setMaxDocumentSidebarWidth] = useState<
    number | null
  >(null);
  const adjustDocumentSidebarWidth = () => {
    if (masterFlexboxRef.current && document.documentElement.clientWidth) {
      // numbers below are based on the actual width the center section for different
      // screen sizes. `1700` corresponds to the custom "3xl" tailwind breakpoint
      // NOTE: some buffer is needed to account for scroll bars
      if (document.documentElement.clientWidth > 1700) {
        setMaxDocumentSidebarWidth(masterFlexboxRef.current.clientWidth - 950);
      } else if (document.documentElement.clientWidth > 1420) {
        setMaxDocumentSidebarWidth(masterFlexboxRef.current.clientWidth - 760);
      } else {
        setMaxDocumentSidebarWidth(masterFlexboxRef.current.clientWidth - 660);
      }
    }
  };

  useEffect(() => {
    if (
      (!personaIncludesRetrieval &&
        (!selectedDocuments || selectedDocuments.length === 0) &&
        documentSidebarVisible) ||
      chatSessionIdRef.current == undefined
    ) {
      setDocumentSidebarVisible(false);
    }
    clientScrollToBottom();
  }, [chatSessionIdRef.current]);

  const loadNewPageLogic = (event: MessageEvent) => {
    if (event.data.type === SUBMIT_MESSAGE_TYPES.PAGE_CHANGE) {
      try {
        const url = new URL(event.data.href);
        processSearchParamsAndSubmitMessage(url.searchParams.toString());
      } catch (error) {
        console.error("Error parsing URL:", error);
      }
    }
  };

  // Equivalent to `loadNewPageLogic`
  useEffect(() => {
    if (searchParams?.get(SEARCH_PARAM_NAMES.SEND_ON_LOAD)) {
      processSearchParamsAndSubmitMessage(searchParams.toString());
    }
  }, [searchParams, router]);

  useEffect(() => {
    adjustDocumentSidebarWidth();
    window.addEventListener("resize", adjustDocumentSidebarWidth);
    window.addEventListener("message", loadNewPageLogic);

    return () => {
      window.removeEventListener("message", loadNewPageLogic);
      window.removeEventListener("resize", adjustDocumentSidebarWidth);
    };
  }, []);

  if (!documentSidebarInitialWidth && maxDocumentSidebarWidth) {
    documentSidebarInitialWidth = Math.min(700, maxDocumentSidebarWidth);
  }
  class CurrentMessageFIFO {
    private stack: PacketType[] = [];
    isComplete: boolean = false;
    error: string | null = null;

    push(packetBunch: PacketType) {
      this.stack.push(packetBunch);
    }

    nextPacket(): PacketType | undefined {
      return this.stack.shift();
    }

    isEmpty(): boolean {
      return this.stack.length === 0;
    }
  }

  async function updateCurrentMessageFIFO(
    stack: CurrentMessageFIFO,
    params: SendMessageParams
  ) {
    try {
      for await (const packet of sendMessage(params)) {
        if (params.signal?.aborted) {
          throw new Error("AbortError");
        }
        stack.push(packet);
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          console.debug("Stream aborted");
        } else {
          stack.error = error.message;
        }
      } else {
        stack.error = String(error);
      }
    } finally {
      stack.isComplete = true;
    }
  }

  const resetInputBar = () => {
    setMessage("");
    setCurrentMessageFiles([]);
    if (endPaddingRef.current) {
      endPaddingRef.current.style.height = `95px`;
    }
  };

  const continueGenerating = () => {
    onSubmit({
      messageOverride:
        "Continue Generating (pick up exactly where you left off)",
    });
  };
  const [uncaughtError, setUncaughtError] = useState<string | null>(null);
  const [agenticGenerating, setAgenticGenerating] = useState(false);

  const autoScrollEnabled =
    (user?.preferences?.auto_scroll && !agenticGenerating) ?? false;

  useScrollonStream({
    chatState: currentSessionChatState,
    scrollableDivRef,
    scrollDist,
    endDivRef,
    debounceNumber,
    mobile: settings?.isMobile,
    enableAutoScroll: autoScrollEnabled,
  });

  // Track whether a message has been sent during this page load, keyed by chat session id
  const [sessionHasSentLocalUserMessage, setSessionHasSentLocalUserMessage] =
    useState<Map<string | null, boolean>>(new Map());

  // Update the local state for a session once the user sends a message
  const markSessionMessageSent = (sessionId: string | null) => {
    setSessionHasSentLocalUserMessage((prev) => {
      const newMap = new Map(prev);
      newMap.set(sessionId, true);
      return newMap;
    });
  };
  const currentSessionHasSentLocalUserMessage = useMemo(
    () => (sessionId: string | null) => {
      return sessionHasSentLocalUserMessage.size === 0
        ? undefined
        : sessionHasSentLocalUserMessage.get(sessionId) || false;
    },
    [sessionHasSentLocalUserMessage]
  );

  const { height: screenHeight } = useScreenSize();

  const getContainerHeight = useMemo(() => {
    return () => {
      if (!currentSessionHasSentLocalUserMessage(chatSessionIdRef.current)) {
        return undefined;
      }
      if (autoScrollEnabled) return undefined;

      if (screenHeight < 600) return "40vh";
      if (screenHeight < 1200) return "50vh";
      return "60vh";
    };
  }, [autoScrollEnabled, screenHeight, currentSessionHasSentLocalUserMessage]);

  const reset = () => {
    setMessage("");
    setCurrentMessageFiles([]);
    clearSelectedItems();
    setLoadingError(null);
  };

  const onSubmit = async ({
    messageIdToResend,
    messageOverride,
    queryOverride,
    forceSearch,
    isSeededChat,
    alternativeAssistantOverride = null,
    modelOverride,
    regenerationRequest,
    overrideFileDescriptors,
  }: {
    messageIdToResend?: number;
    messageOverride?: string;
    queryOverride?: string;
    forceSearch?: boolean;
    isSeededChat?: boolean;
    alternativeAssistantOverride?: Persona | null;
    modelOverride?: LlmDescriptor;
    regenerationRequest?: RegenerationRequest | null;
    overrideFileDescriptors?: FileDescriptor[];
  } = {}) => {
    navigatingAway.current = false;
    let frozenSessionId = currentSessionId();
    updateCanContinue(false, frozenSessionId);
    setUncaughtError(null);
    setLoadingError(null);

    // Mark that we've sent a message for this session in the current page load
    markSessionMessageSent(frozenSessionId);

    // Check if the last message was an error and remove it before proceeding with a new message
    // Ensure this isn't a regeneration or resend, as those operations should preserve the history leading up to the point of regeneration/resend.
    let currentMap = currentMessageMap(completeMessageDetail);
    let currentHistory = buildLatestMessageChain(currentMap);
    let lastMessage = currentHistory[currentHistory.length - 1];

    if (
      lastMessage &&
      lastMessage.type === "error" &&
      !messageIdToResend &&
      !regenerationRequest
    ) {
      const newMap = new Map(currentMap);
      const parentId = lastMessage.parentMessageId;

      // Remove the error message itself
      newMap.delete(lastMessage.messageId);

      // Remove the parent message + update the parent of the parent to no longer
      // link to the parent
      if (parentId !== null && parentId !== undefined) {
        const parentOfError = newMap.get(parentId);
        if (parentOfError) {
          const grandparentId = parentOfError.parentMessageId;
          if (grandparentId !== null && grandparentId !== undefined) {
            const grandparent = newMap.get(grandparentId);
            if (grandparent) {
              // Update grandparent to no longer link to parent
              const updatedGrandparent = {
                ...grandparent,
                childrenMessageIds: (
                  grandparent.childrenMessageIds || []
                ).filter((id) => id !== parentId),
                latestChildMessageId:
                  grandparent.latestChildMessageId === parentId
                    ? null
                    : grandparent.latestChildMessageId,
              };
              newMap.set(grandparentId, updatedGrandparent);
            }
          }
          // Remove the parent message
          newMap.delete(parentId);
        }
      }
      // Update the state immediately so subsequent logic uses the cleaned map
      updateCompleteMessageDetail(frozenSessionId, newMap);
      console.log("Removed previous error message ID:", lastMessage.messageId);

      // update state for the new world (with the error message removed)
      currentHistory = buildLatestMessageChain(newMap);
      currentMap = newMap;
      lastMessage = currentHistory[currentHistory.length - 1];
    }

    if (currentChatState() != "input") {
      if (currentChatState() == "uploading") {
        setPopup({
          message: "Please wait for the content to upload",
          type: "error",
        });
      } else {
        setPopup({
          message: "Please wait for the response to complete",
          type: "error",
        });
      }

      return;
    }

    setAlternativeGeneratingAssistant(alternativeAssistantOverride);

    clientScrollToBottom();

    let currChatSessionId: string;
    const isNewSession = chatSessionIdRef.current === null;

    const searchParamBasedChatSessionName =
      searchParams?.get(SEARCH_PARAM_NAMES.TITLE) || null;

    if (isNewSession) {
      currChatSessionId = await createChatSession(
        liveAssistant?.id || 0,
        searchParamBasedChatSessionName
      );
    } else {
      currChatSessionId = chatSessionIdRef.current as string;
    }
    frozenSessionId = currChatSessionId;
    // update the selected model for the chat session if one is specified so that
    // it persists across page reloads. Do not `await` here so that the message
    // request can continue and this will just happen in the background.
    // NOTE: only set the model override for the chat session once we send a
    // message with it. If the user switches models and then starts a new
    // chat session, it is unexpected for that model to be used when they
    // return to this session the next day.
    let finalLLM = modelOverride || llmManager.currentLlm;
    updateLlmOverrideForChatSession(
      currChatSessionId,
      structureValue(
        finalLLM.name || "",
        finalLLM.provider || "",
        finalLLM.modelName || ""
      )
    );

    updateStatesWithNewSessionId(currChatSessionId);

    const controller = new AbortController();

    setAbortControllers((prev) =>
      new Map(prev).set(currChatSessionId, controller)
    );

    const messageToResend = messageHistory.find(
      (message) => message.messageId === messageIdToResend
    );
    if (messageIdToResend) {
      updateRegenerationState(
        { regenerating: true, finalMessageIndex: messageIdToResend },
        currentSessionId()
      );
    }
    const messageToResendParent =
      messageToResend?.parentMessageId !== null &&
        messageToResend?.parentMessageId !== undefined
        ? currentMap.get(messageToResend.parentMessageId)
        : null;
    const messageToResendIndex = messageToResend
      ? messageHistory.indexOf(messageToResend)
      : null;

    if (!messageToResend && messageIdToResend !== undefined) {
      setPopup({
        message:
          "Failed to re-send message - please refresh the page and try again.",
        type: "error",
      });
      resetRegenerationState(currentSessionId());
      updateChatState("input", frozenSessionId);
      return;
    }
    let currMessage = messageToResend ? messageToResend.message : message;
    if (messageOverride) {
      currMessage = messageOverride;
    }

    setSubmittedMessage(currMessage);

    updateChatState("loading");

    const currMessageHistory =
      messageToResendIndex !== null
        ? currentHistory.slice(0, messageToResendIndex)
        : currentHistory;

    let parentMessage =
      messageToResendParent ||
      (currMessageHistory.length > 0
        ? currMessageHistory[currMessageHistory.length - 1]
        : null) ||
      (currentMap.size === 1 ? Array.from(currentMap.values())[0] : null);

    let currentAssistantId;
    if (alternativeAssistantOverride) {
      currentAssistantId = alternativeAssistantOverride.id;
    } else if (alternativeAssistant) {
      currentAssistantId = alternativeAssistant.id;
    } else {
      currentAssistantId = liveAssistant.id;
    }

    resetInputBar();
    let messageUpdates: Message[] | null = null;

    let answer = "";
    let second_level_answer = "";

    const stopReason: StreamStopReason | null = null;
    let query: string | null = null;
    let retrievalType: RetrievalType =
      selectedDocuments.length > 0
        ? RetrievalType.SelectedDocs
        : RetrievalType.None;
    let documents: OnyxDocument[] = selectedDocuments;
    let aiMessageImages: FileDescriptor[] | null = null;
    let agenticDocs: OnyxDocument[] | null = null;
    let error: string | null = null;
    let stackTrace: string | null = null;

    let sub_questions: SubQuestionDetail[] = [];
    let is_generating: boolean = false;
    let second_level_generating: boolean = false;
    let finalMessage: BackendMessage | null = null;
    let toolCall: ToolCallMetadata | null = null;
    let isImprovement: boolean | undefined = undefined;
    let isStreamingQuestions = true;
    let includeAgentic = false;
    let secondLevelMessageId: number | null = null;
    let isAgentic: boolean = false;
    let files: FileDescriptor[] = [];

    let initialFetchDetails: null | {
      user_message_id: number;
      assistant_message_id: number;
      frozenMessageMap: Map<number, Message>;
    } = null;
    try {
      const mapKeys = Array.from(currentMap.keys());
      const lastSuccessfulMessageId =
        getLastSuccessfulMessageId(currMessageHistory);

      // Route to /api/caseprediction if assistant is Case Analysis
      const isCaseAnalysis = liveAssistant?.name === "Case Analysis";
      setCaseAnalysisConfidence(null);
      setCaseAnalysisReasoning(null);
      if (isCaseAnalysis) {
        setCaseAnalysisConfidence(null);
        setCaseAnalysisReasoning(null);

        try {
          const response = await fetch("/api/caseprediction/", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: currMessage }),
          });

          if (!response.ok) throw new Error("Case analysis failed");

          const result = await response.json(); // { prediction, confidence, reasoning }

          const newMessageId = Date.now();

          const userMessage: Message = {
            messageId: newMessageId - 1,
            message: currMessage,
            type: "user",
            files: [],
            toolCall: null,
            parentMessageId: parentMessage?.messageId || SYSTEM_MESSAGE_ID,
          };

          const predictionLabel =
            result.prediction === 1
              ? "Accepted"
              : result.prediction === 0
                ? "Rejected"
                : result.prediction; // fallback in case it's unexpected

          const confidencePercent = `${result.confidence}%`;

          const assistantMessage: Message = {
            messageId: newMessageId,
            message: `**Prediction:** ${predictionLabel}\n\n**Confidence:** ${confidencePercent}\n\n**Reasoning:** ${result.reasoning}`,
            type: "assistant",
            files: [],
            toolCall: null,
            parentMessageId: userMessage.messageId,
          };

          // Save result for GaugeMeter
          const confidenceValue = parseFloat(result.confidence);
          setCaseAnalysisConfidence(isNaN(confidenceValue) ? null : confidenceValue);
          setCaseAnalysisReasoning(result.reasoning || null);
          setHasCaseAnalysisStarted(true);

          // Add to message map
          upsertToCompleteMessageMap({
            messages: [userMessage, assistantMessage],
            chatSessionId: currChatSessionId,
          });

          try {
            await setMessageAsLatest(assistantMessage.messageId);
          } catch (err) {
            console.error("Failed to set message as latest:", err);
          }

          updateChatState("input");
          resetRegenerationState();
          return;
        } catch (error) {
          console.error("Case Analysis Error:", error);
          updateChatState("input");
          setPopup({
            type: "error",
            message: "Case analysis failed to respond.",
          });
          return;
        }
      }

      // Route to /api/deepsearch/submit if assistant is Deep Search
      const isDeepSearch = liveAssistant?.name === "Deep Search";
      if (isDeepSearch) {
        try {
          // Step 1: Submit deepsearch job
          const submitResponse = await fetch("/api/deepsearch/submit", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: currMessage }),
          });

          if (!submitResponse.ok) throw new Error("Failed to submit Deep Search job");

          const { job_id } = await submitResponse.json();

          // Step 2: Poll for result
          let attempts = 0;
          let result = null;
          const maxAttempts = 100;
          const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

          while (attempts < maxAttempts) {
            const statusResponse = await fetch(`/api/deepsearch/status/${job_id}`);
            if (!statusResponse.ok) throw new Error("Failed to get job status");

            const statusData = await statusResponse.json();
            if (statusData.status === "completed") {
              result = statusData.result;
              break;
            } else if (statusData.status === "error") {
              throw new Error(statusData.error || "Deep Search failed");
            }

            await delay(3000); // wait 3s before next poll
            attempts++;
          }

          if (!result) throw new Error("Deep Search timed out");

          const newMessageId = Date.now();

          const userMessage: Message = {
            messageId: newMessageId - 1,
            message: currMessage,
            type: "user",
            files: [],
            toolCall: null,
            parentMessageId: parentMessage?.messageId || SYSTEM_MESSAGE_ID,
          };

          const assistantMessage: Message = {
            messageId: newMessageId,
            message: result.article || result.outline || "No article, outline or citations was returned from Deep Search.",
            type: "assistant",
            citations: result.citations || {},
            files: [],
            toolCall: null,
            parentMessageId: userMessage.messageId,
          };

          upsertToCompleteMessageMap({
            messages: [userMessage, assistantMessage],
            chatSessionId: currChatSessionId,
          });

          await setMessageAsLatest(assistantMessage.messageId);
          updateChatState("input");
          resetRegenerationState();
          return;
        } catch (err) {
          console.error("Deep Search Error:", err);
          updateChatState("input");
          setPopup({
            type: "error",
            message: "Deep Search failed to respond.",
          });
          return;
        }
      }

      // Route to /api/legacysearch/search if assistant is Legacy Search
      const isLegacySearch = liveAssistant?.name === "Legacy Search";
      if (isLegacySearch) {
        try {
          const response = await fetch("/api/legacysearch/search?query=" + encodeURIComponent(currMessage), {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) throw new Error("Legacy Search failed");

          const result = await response.json(); // { results: [...] }
          const queryId = Date.now().toString();
          setSearchHistory(prev => [
            ...prev,
            { id: queryId, query: currMessage, results: result.results }
          ]);
          setSelectedQueryId(queryId);

          const newMessageId = Date.now();

          const userMessage: Message = {
            messageId: newMessageId - 1,
            message: currMessage,
            type: "user",
            files: [],
            toolCall: null,
            parentMessageId: parentMessage?.messageId || SYSTEM_MESSAGE_ID,
          };

          const assistantMessage: Message = {
            messageId: newMessageId,
            message:
              `**Found ${result.results.length} results.**\n\n` +
              result.results
                .map((r: any, i: number) => {
                  // Clean judgment text
                  const formattedText =
                    (r.all_text || "No content available.")
                      .split("\n")
                      .map((line: string) => `> ${line}`)
                      .join("\n");

                  // Clean case title
                  const caseTitle = String(r.case_title || "Untitled");

                  // Construct full message block
                  let messageBlock =
                    `> **${i + 1}. Case Title:** ${caseTitle}\n` +
                    `> \n` +
                    `> **Judge's Name:** ${r.judges_name || "Unknown"}\n` +
                    `> \n` +
                    `> **Date of Judgement:** ${r.date_of_judgment || "N/A"}\n` +
                    `>\n${formattedText}`;

                  // Remove outer quotes if the whole block is wrapped
                  messageBlock = messageBlock.replace(/^"(.*)"$/, "$1");

                  return messageBlock;
                })
                .join(`\n\n---\n\n`),
            type: "assistant",
            files: [],
            toolCall: null,
            parentMessageId: userMessage.messageId,
          };

          upsertToCompleteMessageMap({
            messages: [userMessage, assistantMessage],
            chatSessionId: currChatSessionId,
          });

          await setMessageAsLatest(assistantMessage.messageId);
          updateChatState("input");
          resetRegenerationState();
          return;

        } catch (error) {
          console.error("Legacy Search Error:", error);
          updateChatState("input");
          setPopup({
            type: "error",
            message: "Legacy Search failed to respond.",
          });
          return;
        }
      }

      const stack = new CurrentMessageFIFO();

      updateCurrentMessageFIFO(stack, {
        signal: controller.signal,
        message: currMessage,
        alternateAssistantId: currentAssistantId,
        fileDescriptors: overrideFileDescriptors || currentMessageFiles,
        parentMessageId:
          regenerationRequest?.parentMessage.messageId ||
          lastSuccessfulMessageId,
        chatSessionId: currChatSessionId,
        filters: buildFilters(
          filterManager.selectedSources,
          filterManager.selectedDocumentSets,
          filterManager.timeRange,
          filterManager.selectedTags,
          selectedFiles.map((file) => file.id),
          selectedFolders.map((folder) => folder.id)
        ),
        selectedDocumentIds: selectedDocuments
          .filter(
            (document) =>
              document.db_doc_id !== undefined && document.db_doc_id !== null
          )
          .map((document) => document.db_doc_id as number),
        queryOverride,
        forceSearch,
        userFolderIds: selectedFolders.map((folder) => folder.id),
        userFileIds: selectedFiles
          .filter((file) => file.id !== undefined && file.id !== null)
          .map((file) => file.id),

        regenerate: regenerationRequest !== undefined,
        modelProvider:
          modelOverride?.name || llmManager.currentLlm.name || undefined,
        modelVersion:
          modelOverride?.modelName ||
          llmManager.currentLlm.modelName ||
          searchParams?.get(SEARCH_PARAM_NAMES.MODEL_VERSION) ||
          undefined,
        temperature: llmManager.temperature || undefined,
        systemPromptOverride:
          searchParams?.get(SEARCH_PARAM_NAMES.SYSTEM_PROMPT) || undefined,
        useExistingUserMessage: isSeededChat,
        useLanggraph:
          settings?.settings.pro_search_enabled &&
          proSearchEnabled &&
          retrievalEnabled,
      });

      const delay = (ms: number) => {
        return new Promise((resolve) => setTimeout(resolve, ms));
      };

      await delay(50);
      while (!stack.isComplete || !stack.isEmpty()) {
        if (stack.isEmpty()) {
          await delay(0.5);
        }

        if (!stack.isEmpty() && !controller.signal.aborted) {
          const packet = stack.nextPacket();
          if (!packet) {
            continue;
          }
          console.log("Packet:", JSON.stringify(packet));

          if (!initialFetchDetails) {
            if (!Object.hasOwn(packet, "user_message_id")) {
              console.error(
                "First packet should contain message response info "
              );
              if (Object.hasOwn(packet, "error")) {
                const error = (packet as StreamingError).error;
                setLoadingError(error);
                updateChatState("input");
                return;
              }
              continue;
            }

            const messageResponseIDInfo = packet as MessageResponseIDInfo;

            const user_message_id = messageResponseIDInfo.user_message_id!;
            const assistant_message_id =
              messageResponseIDInfo.reserved_assistant_message_id;

            // we will use tempMessages until the regenerated message is complete
            messageUpdates = [
              {
                messageId: regenerationRequest
                  ? regenerationRequest?.parentMessage?.messageId!
                  : user_message_id,
                message: currMessage,
                type: "user",
                files: files,
                toolCall: null,
                parentMessageId: parentMessage?.messageId || SYSTEM_MESSAGE_ID,
              },
            ];

            if (parentMessage && !regenerationRequest) {
              messageUpdates.push({
                ...parentMessage,
                childrenMessageIds: (
                  parentMessage.childrenMessageIds || []
                ).concat([user_message_id]),
                latestChildMessageId: user_message_id,
              });
            }

            const { messageMap: currentFrozenMessageMap } =
              upsertToCompleteMessageMap({
                messages: messageUpdates,
                chatSessionId: currChatSessionId,
                completeMessageMapOverride: currentMap,
              });
            currentMap = currentFrozenMessageMap;

            initialFetchDetails = {
              frozenMessageMap: currentMap,
              assistant_message_id,
              user_message_id,
            };

            resetRegenerationState();
          } else {
            const { user_message_id, frozenMessageMap } = initialFetchDetails;
            if (Object.hasOwn(packet, "agentic_message_ids")) {
              const agenticMessageIds = (packet as AgenticMessageResponseIDInfo)
                .agentic_message_ids;
              const level1MessageId = agenticMessageIds.find(
                (item) => item.level === 1
              )?.message_id;
              if (level1MessageId) {
                secondLevelMessageId = level1MessageId;
                includeAgentic = true;
              }
            }

            setChatState((prevState) => {
              if (prevState.get(chatSessionIdRef.current!) === "loading") {
                return new Map(prevState).set(
                  chatSessionIdRef.current!,
                  "streaming"
                );
              }
              return prevState;
            });

            if (Object.hasOwn(packet, "level")) {
              if ((packet as any).level === 1) {
                second_level_generating = true;
              }
            }
            if (Object.hasOwn(packet, "user_files")) {
              const userFiles = (packet as UserKnowledgeFilePacket).user_files;
              // Ensure files are unique by id
              const newUserFiles = userFiles.filter(
                (newFile) =>
                  !files.some((existingFile) => existingFile.id === newFile.id)
              );
              files = files.concat(newUserFiles);
            }
            if (Object.hasOwn(packet, "is_agentic")) {
              isAgentic = (packet as any).is_agentic;
            }

            if (Object.hasOwn(packet, "refined_answer_improvement")) {
              isImprovement = (packet as RefinedAnswerImprovement)
                .refined_answer_improvement;
            }

            if (Object.hasOwn(packet, "stream_type")) {
              if ((packet as any).stream_type == "main_answer") {
                is_generating = false;
                second_level_generating = true;
              }
            }

            // // Continuously refine the sub_questions based on the packets that we receive
            if (
              Object.hasOwn(packet, "stop_reason") &&
              Object.hasOwn(packet, "level_question_num")
            ) {
              if ((packet as StreamStopInfo).stream_type == "main_answer") {
                updateChatState("streaming", frozenSessionId);
              }
              if (
                (packet as StreamStopInfo).stream_type == "sub_questions" &&
                (packet as StreamStopInfo).level_question_num == undefined
              ) {
                isStreamingQuestions = false;
              }
              sub_questions = constructSubQuestions(
                sub_questions,
                packet as StreamStopInfo
              );
            } else if (Object.hasOwn(packet, "sub_question")) {
              updateChatState("toolBuilding", frozenSessionId);
              isAgentic = true;
              is_generating = true;
              sub_questions = constructSubQuestions(
                sub_questions,
                packet as SubQuestionPiece
              );
              setAgenticGenerating(true);
            } else if (Object.hasOwn(packet, "sub_query")) {
              sub_questions = constructSubQuestions(
                sub_questions,
                packet as SubQueryPiece
              );
            } else if (
              Object.hasOwn(packet, "answer_piece") &&
              Object.hasOwn(packet, "answer_type") &&
              (packet as AgentAnswerPiece).answer_type === "agent_sub_answer"
            ) {
              sub_questions = constructSubQuestions(
                sub_questions,
                packet as AgentAnswerPiece
              );
            } else if (Object.hasOwn(packet, "answer_piece")) {
              // Mark every sub_question's is_generating as false
              sub_questions = sub_questions.map((subQ) => ({
                ...subQ,
                is_generating: false,
              }));

              if (
                Object.hasOwn(packet, "level") &&
                (packet as any).level === 1
              ) {
                second_level_answer += (packet as AnswerPiecePacket)
                  .answer_piece;
              } else {
                answer += (packet as AnswerPiecePacket).answer_piece;
              }
            } else if (
              Object.hasOwn(packet, "top_documents") &&
              Object.hasOwn(packet, "level_question_num") &&
              (packet as DocumentsResponse).level_question_num != undefined
            ) {
              const documentsResponse = packet as DocumentsResponse;
              sub_questions = constructSubQuestions(
                sub_questions,
                documentsResponse
              );

              if (
                documentsResponse.level_question_num === 0 &&
                documentsResponse.level == 0
              ) {
                documents = (packet as DocumentsResponse).top_documents;
              } else if (
                documentsResponse.level_question_num === 0 &&
                documentsResponse.level == 1
              ) {
                agenticDocs = (packet as DocumentsResponse).top_documents;
              }
            } else if (Object.hasOwn(packet, "top_documents")) {
              documents = (packet as DocumentInfoPacket).top_documents;
              retrievalType = RetrievalType.Search;

              if (documents && documents.length > 0) {
                // point to the latest message (we don't know the messageId yet, which is why
                // we have to use -1)
                setSelectedMessageForDocDisplay(user_message_id);
              }
            } else if (Object.hasOwn(packet, "tool_name")) {
              // Will only ever be one tool call per message
              toolCall = {
                tool_name: (packet as ToolCallMetadata).tool_name,
                tool_args: (packet as ToolCallMetadata).tool_args,
                tool_result: (packet as ToolCallMetadata).tool_result,
              };

              if (!toolCall.tool_name.includes("agent")) {
                if (
                  !toolCall.tool_result ||
                  toolCall.tool_result == undefined
                ) {
                  updateChatState("toolBuilding", frozenSessionId);
                } else {
                  updateChatState("streaming", frozenSessionId);
                }

                // This will be consolidated in upcoming tool calls udpate,
                // but for now, we need to set query as early as possible
                if (toolCall.tool_name == SEARCH_TOOL_NAME) {
                  query = toolCall.tool_args["query"];
                }
              } else {
                toolCall = null;
              }
            } else if (Object.hasOwn(packet, "file_ids")) {
              aiMessageImages = (packet as FileChatDisplay).file_ids.map(
                (fileId) => {
                  return {
                    id: fileId,
                    type: ChatFileType.IMAGE,
                  };
                }
              );
            } else if (
              Object.hasOwn(packet, "error") &&
              (packet as any).error != null
            ) {
              if (
                sub_questions.length > 0 &&
                sub_questions
                  .filter((q) => q.level === 0)
                  .every((q) => q.is_stopped === true)
              ) {
                setUncaughtError((packet as StreamingError).error);
                updateChatState("input");
                setAgenticGenerating(false);
                setAlternativeGeneratingAssistant(null);
                setSubmittedMessage("");

                throw new Error((packet as StreamingError).error);
              } else {
                error = (packet as StreamingError).error;
                stackTrace = (packet as StreamingError).stack_trace;
              }
            } else if (Object.hasOwn(packet, "message_id")) {
              finalMessage = packet as BackendMessage;
            } else if (Object.hasOwn(packet, "stop_reason")) {
              const stop_reason = (packet as StreamStopInfo).stop_reason;
              if (stop_reason === StreamStopReason.CONTEXT_LENGTH) {
                updateCanContinue(true, frozenSessionId);
              }
            }

            // on initial message send, we insert a dummy system message
            // set this as the parent here if no parent is set
            parentMessage =
              parentMessage || frozenMessageMap?.get(SYSTEM_MESSAGE_ID)!;

            const updateFn = (messages: Message[]) => {
              const replacementsMap = regenerationRequest
                ? new Map([
                  [
                    regenerationRequest?.parentMessage?.messageId,
                    regenerationRequest?.parentMessage?.messageId,
                  ],
                  [
                    regenerationRequest?.messageId,
                    initialFetchDetails?.assistant_message_id,
                  ],
                ] as [number, number][])
                : null;

              const newMessageDetails = upsertToCompleteMessageMap({
                messages: messages,
                replacementsMap: replacementsMap,
                // Pass the latest map state
                completeMessageMapOverride: currentMap,
                chatSessionId: frozenSessionId!,
              });
              currentMap = newMessageDetails.messageMap;
              return newMessageDetails;
            };

            const systemMessageId = Math.min(...mapKeys);
            updateFn([
              {
                messageId: regenerationRequest
                  ? regenerationRequest?.parentMessage?.messageId!
                  : initialFetchDetails.user_message_id!,
                message: currMessage,
                type: "user",
                files: files,
                toolCall: null,
                // in the frontend, every message should have a parent ID
                parentMessageId: lastSuccessfulMessageId ?? systemMessageId,
                childrenMessageIds: [
                  ...(regenerationRequest?.parentMessage?.childrenMessageIds ||
                    []),
                  initialFetchDetails.assistant_message_id!,
                ],
                latestChildMessageId: initialFetchDetails.assistant_message_id,
              },
              {
                isStreamingQuestions: isStreamingQuestions,
                is_generating: is_generating,
                isImprovement: isImprovement,
                messageId: initialFetchDetails.assistant_message_id!,
                message: error || answer,
                second_level_message: second_level_answer,
                type: error ? "error" : "assistant",
                retrievalType,
                query: finalMessage?.rephrased_query || query,
                documents: documents,
                citations: finalMessage?.citations || {},
                files: finalMessage?.files || aiMessageImages || [],
                toolCall: finalMessage?.tool_call || toolCall,
                parentMessageId: regenerationRequest
                  ? regenerationRequest?.parentMessage?.messageId!
                  : initialFetchDetails.user_message_id,
                alternateAssistantID: alternativeAssistant?.id,
                stackTrace: stackTrace,
                overridden_model: finalMessage?.overridden_model,
                stopReason: stopReason,
                sub_questions: sub_questions,
                second_level_generating: second_level_generating,
                agentic_docs: agenticDocs,
                is_agentic: isAgentic,
              },
              ...(includeAgentic
                ? [
                  {
                    messageId: secondLevelMessageId!,
                    message: second_level_answer,
                    type: "assistant" as const,
                    files: [],
                    toolCall: null,
                    parentMessageId:
                      initialFetchDetails.assistant_message_id!,
                  },
                ]
                : []),
            ]);
          }
        }
      }
    } catch (e: any) {
      console.log("Error:", e);
      const errorMsg = e.message;
      const newMessageDetails = upsertToCompleteMessageMap({
        messages: [
          {
            messageId:
              initialFetchDetails?.user_message_id || TEMP_USER_MESSAGE_ID,
            message: currMessage,
            type: "user",
            files: currentMessageFiles,
            toolCall: null,
            parentMessageId: parentMessage?.messageId || SYSTEM_MESSAGE_ID,
          },
          {
            messageId:
              initialFetchDetails?.assistant_message_id ||
              TEMP_ASSISTANT_MESSAGE_ID,
            message: errorMsg,
            type: "error",
            files: aiMessageImages || [],
            toolCall: null,
            parentMessageId:
              initialFetchDetails?.user_message_id || TEMP_USER_MESSAGE_ID,
          },
        ],
        completeMessageMapOverride: currentMap,
      });
      currentMap = newMessageDetails.messageMap;
    }
    console.log("Finished streaming");
    setAgenticGenerating(false);
    resetRegenerationState(currentSessionId());

    updateChatState("input");
    if (isNewSession) {
      console.log("Setting up new session");
      if (finalMessage) {
        setSelectedMessageForDocDisplay(finalMessage.message_id);
      }

      if (!searchParamBasedChatSessionName) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await nameChatSession(currChatSessionId);
        refreshChatSessions();
      }

      // NOTE: don't switch pages if the user has navigated away from the chat
      if (
        currChatSessionId === chatSessionIdRef.current ||
        chatSessionIdRef.current === null
      ) {
        const newUrl = buildChatUrl(searchParams, currChatSessionId, null);
        // newUrl is like /chat?chatId=10
        // current page is like /chat

        if (pathname == "/chat" && !navigatingAway.current) {
          router.push(newUrl, { scroll: false });
        }
      }
    }
    if (
      finalMessage?.context_docs &&
      finalMessage.context_docs.top_documents.length > 0 &&
      retrievalType === RetrievalType.Search
    ) {
      setSelectedMessageForDocDisplay(finalMessage.message_id);
    }
    setAlternativeGeneratingAssistant(null);
    setSubmittedMessage("");
  };

  const onFeedback = async (
    messageId: number,
    feedbackType: FeedbackType,
    feedbackDetails: string,
    predefinedFeedback: string | undefined
  ) => {
    if (chatSessionIdRef.current === null) {
      return;
    }

    const response = await handleChatFeedback(
      messageId,
      feedbackType,
      feedbackDetails,
      predefinedFeedback
    );

    if (response.ok) {
      setPopup({
        message: "Thanks for your feedback!",
        type: "success",
      });
    } else {
      const responseJson = await response.json();
      const errorMsg = responseJson.detail || responseJson.message;
      setPopup({
        message: `Failed to submit feedback - ${errorMsg}`,
        type: "error",
      });
    }
  };

  const handleImageUpload = async (
    acceptedFiles: File[],
    intent: UploadIntent
  ) => {
    const [_, llmModel] = getFinalLLM(
      llmProviders,
      liveAssistant,
      llmManager.currentLlm
    );
    const llmAcceptsImages = modelSupportsImageInput(llmProviders, llmModel);

    const imageFiles = acceptedFiles.filter((file) =>
      file.type.startsWith("image/")
    );

    if (imageFiles.length > 0 && !llmAcceptsImages) {
      setPopup({
        type: "error",
        message:
          "The current model does not support image input. Please select a model with Vision support.",
      });
      return;
    }

    updateChatState("uploading", currentSessionId());

    const newlyUploadedFileDescriptors: FileDescriptor[] = [];

    for (let file of acceptedFiles) {
      const formData = new FormData();
      formData.append("files", file);
      const response: FileResponse[] = await uploadFile(formData, null);

      if (response.length > 0) {
        const uploadedFile = response[0];

        if (intent == UploadIntent.ADD_TO_DOCUMENTS) {
          addSelectedFile(uploadedFile);
        } else {
          const newFileDescriptor: FileDescriptor = {
            // Use file_id (storage ID) if available, otherwise fallback to DB id
            // Ensure it's a string as FileDescriptor expects
            id: uploadedFile.file_id
              ? String(uploadedFile.file_id)
              : String(uploadedFile.id),
            type: uploadedFile.chat_file_type
              ? uploadedFile.chat_file_type
              : ChatFileType.PLAIN_TEXT,
            name: uploadedFile.name,
            isUploading: false, // Mark as successfully uploaded
          };

          setCurrentMessageFiles((prev) => [...prev, newFileDescriptor]);
        }
      } else {
        setPopup({
          type: "error",
          message: "Failed to upload file",
        });
      }
    }

    updateChatState("input", currentSessionId());
  };

  // Used to maintain a "time out" for history sidebar so our existing refs can have time to process change
  const [untoggled, setUntoggled] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  const explicitlyUntoggle = () => {
    setShowHistorySidebar(false);

    setUntoggled(true);
    setTimeout(() => {
      setUntoggled(false);
    }, 200);
  };
  const toggleSidebar = () => {
    if (user?.is_anonymous_user) {
      return;
    }
    Cookies.set(
      SIDEBAR_TOGGLED_COOKIE_NAME,
      String(!sidebarVisible).toLocaleLowerCase()
    ),
    {
      path: "/",
    };

    toggle();
  };
  const removeToggle = () => {
    setShowHistorySidebar(false);
    toggle(false);
  };

  const waitForScrollRef = useRef(false);
  const sidebarElementRef = useRef<HTMLDivElement>(null);

  useSidebarVisibility({
    sidebarVisible,
    sidebarElementRef,
    showDocSidebar: showHistorySidebar,
    setShowDocSidebar: setShowHistorySidebar,
    setToggled: removeToggle,
    mobile: settings?.isMobile,
    isAnonymousUser: user?.is_anonymous_user,
  });

  // Virtualization + Scrolling related effects and functions
  const scrollInitialized = useRef(false);

  const imageFileInMessageHistory = useMemo(() => {
    return messageHistory
      .filter((message) => message.type === "user")
      .some((message) =>
        message.files.some((file) => file.type === ChatFileType.IMAGE)
      );
  }, [messageHistory]);

  useSendMessageToParent();

  useEffect(() => {
    if (liveAssistant) {
      const hasSearchTool = liveAssistant.tools.some(
        (tool) =>
          tool.in_code_tool_id === SEARCH_TOOL_ID &&
          liveAssistant.user_file_ids?.length == 0 &&
          liveAssistant.user_folder_ids?.length == 0
      );
      setRetrievalEnabled(hasSearchTool);
      if (!hasSearchTool) {
        filterManager.clearFilters();
      }
    }
  }, [liveAssistant]);

  const [retrievalEnabled, setRetrievalEnabled] = useState(() => {
    if (liveAssistant) {
      return liveAssistant.tools.some(
        (tool) =>
          tool.in_code_tool_id === SEARCH_TOOL_ID &&
          liveAssistant.user_file_ids?.length == 0 &&
          liveAssistant.user_folder_ids?.length == 0
      );
    }
    return false;
  });

  useEffect(() => {
    if (!retrievalEnabled) {
      setDocumentSidebarVisible(false);
    }
  }, [retrievalEnabled]);

  const [stackTraceModalContent, setStackTraceModalContent] = useState<
    string | null
  >(null);

  const innerSidebarElementRef = useRef<HTMLDivElement>(null);
  const [settingsToggled, setSettingsToggled] = useState(false);

  const [selectedDocuments, setSelectedDocuments] = useState<OnyxDocument[]>(
    []
  );
  const [selectedDocumentTokens, setSelectedDocumentTokens] = useState(0);

  const currentPersona = alternativeAssistant || liveAssistant;

  const HORIZON_DISTANCE = 800;
  const handleScroll = useCallback(() => {
    const scrollDistance =
      endDivRef?.current?.getBoundingClientRect()?.top! -
      inputRef?.current?.getBoundingClientRect()?.top!;
    scrollDist.current = scrollDistance;
    setAboveHorizon(scrollDist.current > HORIZON_DISTANCE);
  }, []);

  useEffect(() => {
    const handleSlackChatRedirect = async () => {
      if (!slackChatId) return;

      // Set isReady to false before starting retrieval to display loading text
      setIsReady(false);

      try {
        const response = await fetch("/api/chat/seed-chat-session-from-slack", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_session_id: slackChatId,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to seed chat from Slack");
        }

        const data = await response.json();

        router.push(data.redirect_url);
      } catch (error) {
        console.error("Error seeding chat from Slack:", error);
        setPopup({
          message: "Failed to load chat from Slack",
          type: "error",
        });
      }
    };

    handleSlackChatRedirect();
  }, [searchParams, router]);

  useEffect(() => {
    llmManager.updateImageFilesPresent(imageFileInMessageHistory);
  }, [imageFileInMessageHistory]);

  const pathname = usePathname();
  useEffect(() => {
    return () => {
      // Cleanup which only runs when the component unmounts (i.e. when you navigate away).
      const currentSession = currentSessionId();
      const controller = abortControllersRef.current.get(currentSession);
      if (controller) {
        controller.abort();
        navigatingAway.current = true;
        setAbortControllers((prev) => {
          const newControllers = new Map(prev);
          newControllers.delete(currentSession);
          return newControllers;
        });
      }
    };
  }, [pathname]);

  const navigatingAway = useRef(false);
  // Keep a ref to abortControllers to ensure we always have the latest value
  const abortControllersRef = useRef(abortControllers);
  useEffect(() => {
    abortControllersRef.current = abortControllers;
  }, [abortControllers]);
  useEffect(() => {
    const calculateTokensAndUpdateSearchMode = async () => {
      if (selectedFiles.length > 0 || selectedFolders.length > 0) {
        try {
          // Prepare the query parameters for the API call
          const fileIds = selectedFiles.map((file: FileResponse) => file.id);
          const folderIds = selectedFolders.map(
            (folder: FolderResponse) => folder.id
          );

          // Build the query string
          const queryParams = new URLSearchParams();
          fileIds.forEach((id) =>
            queryParams.append("file_ids", id.toString())
          );
          folderIds.forEach((id) =>
            queryParams.append("folder_ids", id.toString())
          );

          // Make the API call to get token estimate
          const response = await fetch(
            `/api/user/file/token-estimate?${queryParams.toString()}`
          );

          if (!response.ok) {
            console.error("Failed to fetch token estimate");
            return;
          }
        } catch (error) {
          console.error("Error calculating tokens:", error);
        }
      }
    };

    calculateTokensAndUpdateSearchMode();
  }, [selectedFiles, selectedFolders, llmManager.currentLlm]);

  useSidebarShortcut(router, toggleSidebar);

  const [sharedChatSession, setSharedChatSession] =
    useState<ChatSession | null>();

  const handleResubmitLastMessage = () => {
    // Grab the last user-type message
    const lastUserMsg = messageHistory
      .slice()
      .reverse()
      .find((m) => m.type === "user");
    if (!lastUserMsg) {
      setPopup({
        message: "No previously-submitted user message found.",
        type: "error",
      });
      return;
    }

    // We call onSubmit, passing a `messageOverride`
    onSubmit({
      messageIdToResend: lastUserMsg.messageId,
      messageOverride: lastUserMsg.message,
    });
  };

  const showShareModal = (chatSession: ChatSession) => {
    setSharedChatSession(chatSession);
  };
  const [showAssistantsModal, setShowAssistantsModal] = useState(false);

  const toggleDocumentSidebar = () => {
    if (!documentSidebarVisible) {
      setDocumentSidebarVisible(true);
    } else {
      setDocumentSidebarVisible(false);
    }
  };

  interface RegenerationRequest {
    messageId: number;
    parentMessage: Message;
    forceSearch?: boolean;
  }

  function createRegenerator(regenerationRequest: RegenerationRequest) {
    // Returns new function that only needs `modelOverRide` to be specified when called
    return async function (modelOverride: LlmDescriptor) {
      return await onSubmit({
        modelOverride,
        messageIdToResend: regenerationRequest.parentMessage.messageId,
        regenerationRequest,
        forceSearch: regenerationRequest.forceSearch,
      });
    };
  }
  if (!user) {
    redirect("/auth/login");
  }

  if (noAssistants)
    return (
      <>
        <HealthCheckBanner />
        <NoAssistantModal isAdmin={isAdmin} />
      </>
    );

  return (
    <>
      <HealthCheckBanner />

      {showApiKeyModal && !shouldShowWelcomeModal && (
        <ApiKeyModal
          hide={() => setShowApiKeyModal(false)}
          setPopup={setPopup}
        />
      )}

      {/* ChatPopup is a custom popup that displays a admin-specified message on initial user visit. 
      Only used in the EE version of the app. */}
      {popup}

      <div className="relative w-full">
        {liveAssistant?.name === "Case Analysis" && hasCaseAnalysisStarted && (
          <div
            className="fixed bottom-4 right-4 z-30 flex justify-end"
            title="Model Confidence"
            style={{
              width: `${gaugeSize}px`,
              transition: "width 0.2s ease-in-out",
            }}
          >
            <GaugeMeter value={caseAnalysisConfidence ?? 0} />
          </div>
        )}
      </div>

      <ChatPopup />

      {currentFeedback && (
        <FeedbackModal
          feedbackType={currentFeedback[0]}
          onClose={() => setCurrentFeedback(null)}
          onSubmit={({ message, predefinedFeedback }) => {
            onFeedback(
              currentFeedback[1],
              currentFeedback[0],
              message,
              predefinedFeedback
            );
            setCurrentFeedback(null);
          }}
        />
      )}

      {(settingsToggled || userSettingsToggled) && (
        <UserSettingsModal
          setPopup={setPopup}
          setCurrentLlm={(newLlm) => llmManager.updateCurrentLlm(newLlm)}
          defaultModel={user?.preferences.default_model!}
          llmProviders={llmProviders}
          onClose={() => {
            setUserSettingsToggled(false);
            setSettingsToggled(false);
          }}
        />
      )}

      {toggleDocSelection && (
        <FilePickerModal
          setPresentingDocument={setPresentingDocument}
          buttonContent="Set as Context"
          isOpen={true}
          onClose={() => setToggleDocSelection(false)}
          onSave={() => {
            setToggleDocSelection(false);
          }}
        />
      )}

      <ChatSearchModal
        open={isChatSearchModalOpen}
        onCloseModal={() => setIsChatSearchModalOpen(false)}
      />

      {retrievalEnabled && documentSidebarVisible && settings?.isMobile && (
        <div className="md:hidden">
          <Modal
            hideDividerForTitle
            onOutsideClick={() => setDocumentSidebarVisible(false)}
            title="Sources"
          >
            <DocumentResults
              agenticMessage={
                aiMessage?.sub_questions?.length! > 0 ||
                  messageHistory.find(
                    (m) => m.messageId === aiMessage?.parentMessageId
                  )?.sub_questions?.length! > 0
                  ? true
                  : false
              }
              humanMessage={humanMessage}
              setPresentingDocument={setPresentingDocument}
              modal={true}
              ref={innerSidebarElementRef}
              closeSidebar={() => {
                setDocumentSidebarVisible(false);
              }}
              selectedMessage={aiMessage}
              selectedDocuments={selectedDocuments}
              toggleDocumentSelection={toggleDocumentSelection}
              clearSelectedDocuments={clearSelectedDocuments}
              selectedDocumentTokens={selectedDocumentTokens}
              maxTokens={maxTokens}
              initialWidth={400}
              isOpen={true}
              removeHeader
            />
          </Modal>
        </div>
      )}

      {presentingDocument && (
        <TextView
          presentingDocument={presentingDocument}
          onClose={() => setPresentingDocument(null)}
        />
      )}

      {stackTraceModalContent && (
        <ExceptionTraceModal
          onOutsideClick={() => setStackTraceModalContent(null)}
          exceptionTrace={stackTraceModalContent}
        />
      )}

      {sharedChatSession && (
        <ShareChatSessionModal
          assistantId={liveAssistant?.id}
          message={message}
          modelOverride={llmManager.currentLlm}
          chatSessionId={sharedChatSession.id}
          existingSharedStatus={sharedChatSession.shared_status}
          onClose={() => setSharedChatSession(null)}
          onShare={(shared) =>
            setChatSessionSharedStatus(
              shared
                ? ChatSessionSharedStatus.Public
                : ChatSessionSharedStatus.Private
            )
          }
        />
      )}

      {sharingModalVisible && chatSessionIdRef.current !== null && (
        <ShareChatSessionModal
          message={message}
          assistantId={liveAssistant?.id}
          modelOverride={llmManager.currentLlm}
          chatSessionId={chatSessionIdRef.current}
          existingSharedStatus={chatSessionSharedStatus}
          onClose={() => setSharingModalVisible(false)}
        />
      )}

      {showAssistantsModal && (
        <AssistantModal hideModal={() => setShowAssistantsModal(false)} />
      )}

      <div className="fixed inset-0 flex flex-col text-text-dark">
        <div className="h-[100dvh] overflow-y-hidden">
          <div className="w-full">
            <div
              ref={sidebarElementRef}
              className={`
                flex-none
                fixed
                left-0
                z-40
                bg-neutral-200
                h-screen
                transition-all
                bg-opacity-80
                duration-300
                ease-in-out
                ${!untoggled && (showHistorySidebar || sidebarVisible)
                  ? "opacity-100 w-[250px] translate-x-0"
                  : "opacity-0 w-[250px] pointer-events-none -translate-x-10"
                }`}
            >
              <div className="w-full relative">
                <HistorySidebar
                  toggleChatSessionSearchModal={() =>
                    setIsChatSearchModalOpen((open) => !open)
                  }
                  liveAssistant={liveAssistant}
                  setShowAssistantsModal={setShowAssistantsModal}
                  explicitlyUntoggle={explicitlyUntoggle}
                  reset={reset}
                  page="chat"
                  ref={innerSidebarElementRef}
                  toggleSidebar={toggleSidebar}
                  toggled={sidebarVisible}
                  existingChats={chatSessions}
                  currentChatSession={selectedChatSession}
                  folders={folders}
                  removeToggle={removeToggle}
                  showShareModal={showShareModal}
                />
              </div>

              <div
                className={`
                flex-none
                fixed
                left-0
                z-40
                bg-background-100
                h-screen
                transition-all
                bg-opacity-80
                duration-300
                ease-in-out
                ${documentSidebarVisible &&
                  !settings?.isMobile &&
                  "opacity-100 w-[350px]"
                  }`}
              ></div>
            </div>
          </div>

          <div
            style={{ transition: "width 0.30s ease-out" }}
            className={`
                flex-none 
                fixed
                right-0
                z-[1000]
                h-screen
                transition-all
                duration-300
                ease-in-out
                bg-transparent
                transition-all
                duration-300
                ease-in-out
                h-full
                ${documentSidebarVisible && !settings?.isMobile
                ? "w-[400px]"
                : "w-[0px]"
              }
            `}
          >
            <DocumentResults
              humanMessage={humanMessage}
              agenticMessage={
                aiMessage?.sub_questions?.length! > 0 ||
                  messageHistory.find(
                    (m) => m.messageId === aiMessage?.parentMessageId
                  )?.sub_questions?.length! > 0
                  ? true
                  : false
              }
              setPresentingDocument={setPresentingDocument}
              modal={false}
              ref={innerSidebarElementRef}
              closeSidebar={() =>
                setTimeout(() => setDocumentSidebarVisible(false), 300)
              }
              selectedMessage={aiMessage}
              selectedDocuments={selectedDocuments}
              toggleDocumentSelection={toggleDocumentSelection}
              clearSelectedDocuments={clearSelectedDocuments}
              selectedDocumentTokens={selectedDocumentTokens}
              maxTokens={maxTokens}
              initialWidth={400}
              isOpen={documentSidebarVisible && !settings?.isMobile}
            />
          </div>

          <BlurBackground
            visible={!untoggled && (showHistorySidebar || sidebarVisible)}
            onClick={() => toggleSidebar()}
          />

          <div
            ref={masterFlexboxRef}
            className="flex h-full w-full overflow-x-hidden"
          >
            <div
              id="scrollableContainer"
              className="flex h-full relative px-2 flex-col w-full"
            >
              {liveAssistant && (
                <FunctionalHeader
                  toggleUserSettings={() => setUserSettingsToggled(true)}
                  sidebarToggled={sidebarVisible}
                  reset={() => setMessage("")}
                  page="chat"
                  setSharingModalVisible={
                    chatSessionIdRef.current !== null
                      ? setSharingModalVisible
                      : undefined
                  }
                  documentSidebarVisible={
                    documentSidebarVisible && !settings?.isMobile
                  }
                  toggleSidebar={toggleSidebar}
                  currentChatSession={selectedChatSession}
                  hideUserDropdown={user?.is_anonymous_user}
                />
              )}

              {documentSidebarInitialWidth !== undefined && isReady ? (
                <Dropzone
                  key={currentSessionId()}
                  onDrop={(acceptedFiles) =>
                    handleImageUpload(
                      acceptedFiles,
                      UploadIntent.ATTACH_TO_MESSAGE
                    )
                  }
                  noClick
                >
                  {({ getRootProps }) => (
                    <div className="flex h-full w-full">
                      {!settings?.isMobile && (
                        <div
                          style={{ transition: "width 0.30s ease-out" }}
                          className={`
                          flex-none 
                          overflow-y-hidden 
                          bg-transparent
                          transition-all 
                          bg-opacity-80
                          duration-300 
                          ease-in-out
                          h-full
                          ${sidebarVisible ? "w-[200px]" : "w-[0px]"}
                      `}
                        ></div>
                      )}

                      <div
                        className={`h-full w-full relative flex-auto transition-margin duration-300 overflow-x-auto mobile:pb-12 desktop:pb-[100px]`}
                        {...getRootProps()}
                      >
                        <div
                          onScroll={handleScroll}
                          className={`w-full h-[calc(100vh-160px)] flex flex-col default-scrollbar overflow-y-auto overflow-x-hidden relative`}
                          ref={scrollableDivRef}
                        >
                          {liveAssistant && (
                            <div className="z-20 fixed top-0 pointer-events-none left-0 w-full flex justify-center overflow-visible">
                              {!settings?.isMobile && (
                                <div
                                  style={{ transition: "width 0.30s ease-out" }}
                                  className={`
                                  flex-none 
                                  overflow-y-hidden 
                                  transition-all 
                                  pointer-events-none
                                  duration-300 
                                  ease-in-out
                                  h-full
                                  ${sidebarVisible ? "w-[200px]" : "w-[0px]"}
                              `}
                                />
                              )}
                            </div>
                          )}
                          {/* ChatBanner is a custom banner that displays a admin-specified message at 
                      the top of the chat page. Oly used in the EE version of the app. */}
                          {messageHistory.length === 0 &&
                            !isFetchingChatMessages &&
                            currentSessionChatState == "input" &&
                            !loadingError &&
                            !submittedMessage && (
                              <div className="h-full  w-[95%] mx-auto flex flex-col justify-center items-center">
                                <ChatIntro selectedPersona={liveAssistant} />

                                <StarterMessages
                                  currentPersona={currentPersona}
                                  onSubmit={(messageOverride) =>
                                    onSubmit({
                                      messageOverride,
                                    })
                                  }
                                />
                              </div>
                            )}
                          <div
                            style={{ overflowAnchor: "none" }}
                            key={currentSessionId()}
                            className={
                              (hasPerformedInitialScroll ? "" : " hidden ") +
                              "desktop:-ml-4 w-full mx-auto " +
                              "absolute mobile:top-0 desktop:top-0 left-0 " +
                              (settings?.enterpriseSettings
                                ?.two_lines_for_chat_header
                                ? "pt-20 "
                                : "pt-4 ")
                            }
                          // NOTE: temporarily removing this to fix the scroll bug
                          // (hasPerformedInitialScroll ? "" : "invisible")
                          >
                            {messageHistory.map((message, i) => {
                              const messageMap = currentMessageMap(
                                completeMessageDetail
                              );

                              if (
                                currentRegenerationState()?.finalMessageIndex &&
                                currentRegenerationState()?.finalMessageIndex! <
                                message.messageId
                              ) {
                                return <></>;
                              }

                              const messageReactComponentKey = `${i}-${currentSessionId()}`;
                              const parentMessage = message.parentMessageId
                                ? messageMap.get(message.parentMessageId)
                                : null;
                              if (message.type === "user") {
                                if (
                                  (currentSessionChatState == "loading" &&
                                    i == messageHistory.length - 1) ||
                                  (currentSessionRegenerationState?.regenerating &&
                                    message.messageId >=
                                    currentSessionRegenerationState?.finalMessageIndex!)
                                ) {
                                  return <></>;
                                }
                                const nextMessage =
                                  messageHistory.length > i + 1
                                    ? messageHistory[i + 1]
                                    : null;
                                return (
                                  <div
                                    id={`message-${message.messageId}`}
                                    key={messageReactComponentKey}
                                  >
                                    <HumanMessage
                                      setPresentingDocument={
                                        setPresentingDocument
                                      }
                                      disableSwitchingForStreaming={
                                        (nextMessage &&
                                          nextMessage.is_generating) ||
                                        false
                                      }
                                      stopGenerating={stopGenerating}
                                      content={message.message}
                                      files={message.files}
                                      messageId={message.messageId}
                                      onEdit={(editedContent) => {
                                        const parentMessageId =
                                          message.parentMessageId!;
                                        const parentMessage =
                                          messageMap.get(parentMessageId)!;
                                        upsertToCompleteMessageMap({
                                          messages: [
                                            {
                                              ...parentMessage,
                                              latestChildMessageId: null,
                                            },
                                          ],
                                        });
                                        onSubmit({
                                          messageIdToResend:
                                            message.messageId || undefined,
                                          messageOverride: editedContent,
                                        });
                                      }}
                                      otherMessagesCanSwitchTo={
                                        parentMessage?.childrenMessageIds || []
                                      }
                                      onMessageSelection={(messageId) => {
                                        const newCompleteMessageMap = new Map(
                                          messageMap
                                        );
                                        newCompleteMessageMap.get(
                                          message.parentMessageId!
                                        )!.latestChildMessageId = messageId;
                                        updateCompleteMessageDetail(
                                          currentSessionId(),
                                          newCompleteMessageMap
                                        );
                                        setSelectedMessageForDocDisplay(
                                          messageId
                                        );
                                        // set message as latest so we can edit this message
                                        // and so it sticks around on page reload
                                        setMessageAsLatest(messageId);
                                      }}
                                    />
                                  </div>
                                );
                              } else if (message.type === "assistant") {
                                const previousMessage =
                                  i !== 0 ? messageHistory[i - 1] : null;

                                const currentAlternativeAssistant =
                                  message.alternateAssistantID != null
                                    ? availableAssistants.find(
                                      (persona) =>
                                        persona.id ==
                                        message.alternateAssistantID
                                    )
                                    : null;

                                if (
                                  (currentSessionChatState == "loading" &&
                                    i > messageHistory.length - 1) ||
                                  (currentSessionRegenerationState?.regenerating &&
                                    message.messageId >
                                    currentSessionRegenerationState?.finalMessageIndex!)
                                ) {
                                  return <></>;
                                }
                                if (parentMessage?.type == "assistant") {
                                  return <></>;
                                }
                                const secondLevelMessage =
                                  messageHistory[i + 1]?.type === "assistant"
                                    ? messageHistory[i + 1]
                                    : undefined;

                                const secondLevelAssistantMessage =
                                  messageHistory[i + 1]?.type === "assistant"
                                    ? messageHistory[i + 1]?.message
                                    : undefined;

                                const agenticDocs =
                                  messageHistory[i + 1]?.type === "assistant"
                                    ? messageHistory[i + 1]?.documents
                                    : undefined;

                                const nextMessage =
                                  messageHistory[i + 1]?.type === "assistant"
                                    ? messageHistory[i + 1]
                                    : undefined;

                                const attachedFileDescriptors =
                                  previousMessage?.files.filter(
                                    (file) =>
                                      file.type == ChatFileType.USER_KNOWLEDGE
                                  );
                                const userFiles = allUserFiles?.filter((file) =>
                                  attachedFileDescriptors?.some(
                                    (descriptor) =>
                                      descriptor.id === file.file_id
                                  )
                                );

                                return (
                                  <div
                                    className="text-text"
                                    id={`message-${message.messageId}`}
                                    key={messageReactComponentKey}
                                    ref={
                                      i == messageHistory.length - 1
                                        ? lastMessageRef
                                        : null
                                    }
                                  >
                                    {message.is_agentic ? (
                                      <AgenticMessage
                                        resubmit={handleResubmitLastMessage}
                                        error={uncaughtError}
                                        isStreamingQuestions={
                                          message.isStreamingQuestions ?? false
                                        }
                                        isGenerating={
                                          message.is_generating ?? false
                                        }
                                        docSidebarToggled={
                                          documentSidebarVisible &&
                                          (selectedMessageForDocDisplay ==
                                            message.messageId ||
                                            selectedMessageForDocDisplay ==
                                            secondLevelMessage?.messageId)
                                        }
                                        isImprovement={
                                          message.isImprovement ||
                                          nextMessage?.isImprovement
                                        }
                                        secondLevelGenerating={
                                          (message.second_level_generating &&
                                            currentSessionChatState !==
                                            "input") ||
                                          false
                                        }
                                        secondLevelSubquestions={message.sub_questions?.filter(
                                          (subQuestion) =>
                                            subQuestion.level === 1
                                        )}
                                        secondLevelAssistantMessage={
                                          (message.second_level_message &&
                                            message.second_level_message.length >
                                            0
                                            ? message.second_level_message
                                            : secondLevelAssistantMessage) ||
                                          undefined
                                        }
                                        subQuestions={
                                          message.sub_questions?.filter(
                                            (subQuestion) =>
                                              subQuestion.level === 0
                                          ) || []
                                        }
                                        agenticDocs={
                                          message.agentic_docs || agenticDocs
                                        }
                                        toggleDocDisplay={(
                                          agentic: boolean
                                        ) => {
                                          if (agentic) {
                                            setSelectedMessageForDocDisplay(
                                              message.messageId
                                            );
                                          } else {
                                            setSelectedMessageForDocDisplay(
                                              secondLevelMessage
                                                ? secondLevelMessage.messageId
                                                : null
                                            );
                                          }
                                        }}
                                        docs={
                                          message?.documents &&
                                            message?.documents.length > 0
                                            ? message?.documents
                                            : parentMessage?.documents
                                        }
                                        setPresentingDocument={
                                          setPresentingDocument
                                        }
                                        continueGenerating={
                                          i == messageHistory.length - 1 &&
                                            currentCanContinue()
                                            ? continueGenerating
                                            : undefined
                                        }
                                        overriddenModel={
                                          message.overridden_model
                                        }
                                        regenerate={
                                          liveAssistant?.name === "Case Analysis" ||
                                            liveAssistant?.id === -4 ||
                                            liveAssistant?.name === "Deep Search" ||
                                            liveAssistant?.id === -5 ||
                                            liveAssistant?.name === "Legacy Search" ||
                                            liveAssistant?.id === -6
                                            ? undefined
                                            : createRegenerator({
                                              messageId: message.messageId,
                                              parentMessage: parentMessage!,
                                            })
                                        }
                                        otherMessagesCanSwitchTo={
                                          parentMessage?.childrenMessageIds ||
                                          []
                                        }
                                        onMessageSelection={(messageId) => {
                                          const newCompleteMessageMap = new Map(
                                            messageMap
                                          );
                                          newCompleteMessageMap.get(
                                            message.parentMessageId!
                                          )!.latestChildMessageId = messageId;

                                          updateCompleteMessageDetail(
                                            currentSessionId(),
                                            newCompleteMessageMap
                                          );

                                          setSelectedMessageForDocDisplay(
                                            messageId
                                          );
                                          // set message as latest so we can edit this message
                                          // and so it sticks around on page reload
                                          setMessageAsLatest(messageId);
                                        }}
                                        isActive={
                                          messageHistory.length - 1 == i ||
                                          messageHistory.length - 2 == i
                                        }
                                        selectedDocuments={selectedDocuments}
                                        toggleDocumentSelection={(
                                          second: boolean
                                        ) => {
                                          if (
                                            (!second &&
                                              !documentSidebarVisible) ||
                                            (documentSidebarVisible &&
                                              selectedMessageForDocDisplay ===
                                              message.messageId)
                                          ) {
                                            toggleDocumentSidebar();
                                          }
                                          if (
                                            (second &&
                                              !documentSidebarVisible) ||
                                            (documentSidebarVisible &&
                                              selectedMessageForDocDisplay ===
                                              secondLevelMessage?.messageId)
                                          ) {
                                            toggleDocumentSidebar();
                                          }

                                          setSelectedMessageForDocDisplay(
                                            second
                                              ? secondLevelMessage?.messageId ||
                                              null
                                              : message.messageId
                                          );
                                        }}
                                        currentPersona={liveAssistant}
                                        alternativeAssistant={
                                          currentAlternativeAssistant
                                        }
                                        messageId={message.messageId}
                                        content={message.message}
                                        files={message.files}
                                        query={
                                          messageHistory[i]?.query || undefined
                                        }
                                        citedDocuments={getCitedDocumentsFromMessage(
                                          message
                                        )}
                                        toolCall={message.toolCall}
                                        isComplete={
                                          i !== messageHistory.length - 1 ||
                                          (currentSessionChatState !=
                                            "streaming" &&
                                            currentSessionChatState !=
                                            "toolBuilding")
                                        }
                                        handleFeedback={
                                          i === messageHistory.length - 1 &&
                                            currentSessionChatState != "input"
                                            ? undefined
                                            : (feedbackType: FeedbackType) =>
                                              setCurrentFeedback([
                                                feedbackType,
                                                message.messageId as number,
                                              ])
                                        }
                                      />
                                    ) : (
                                      <AIMessage
                                        userKnowledgeFiles={userFiles}
                                        docs={
                                          message?.documents &&
                                            message?.documents.length > 0
                                            ? message?.documents
                                            : parentMessage?.documents
                                        }
                                        setPresentingDocument={
                                          setPresentingDocument
                                        }
                                        index={i}
                                        continueGenerating={
                                          i == messageHistory.length - 1 &&
                                            currentCanContinue()
                                            ? continueGenerating
                                            : undefined
                                        }
                                        overriddenModel={
                                          message.overridden_model
                                        }
                                        regenerate={
                                          liveAssistant?.name === "Case Analysis" ||
                                            liveAssistant?.id === -4 ||
                                            liveAssistant?.name === "Deep Search" ||
                                            liveAssistant?.id === -5 ||
                                            liveAssistant?.name === "Legacy Search" ||
                                            liveAssistant?.id === -6
                                            ? undefined
                                            : createRegenerator({
                                              messageId: message.messageId,
                                              parentMessage: parentMessage!,
                                            })
                                        }
                                        otherMessagesCanSwitchTo={
                                          parentMessage?.childrenMessageIds ||
                                          []
                                        }
                                        onMessageSelection={(messageId) => {
                                          const newCompleteMessageMap = new Map(
                                            messageMap
                                          );
                                          newCompleteMessageMap.get(
                                            message.parentMessageId!
                                          )!.latestChildMessageId = messageId;

                                          updateCompleteMessageDetail(
                                            currentSessionId(),
                                            newCompleteMessageMap
                                          );

                                          setSelectedMessageForDocDisplay(
                                            messageId
                                          );
                                          // set message as latest so we can edit this message
                                          // and so it sticks around on page reload
                                          setMessageAsLatest(messageId);
                                        }}
                                        isActive={
                                          messageHistory.length - 1 == i
                                        }
                                        selectedDocuments={selectedDocuments}
                                        toggleDocumentSelection={() => {
                                          if (
                                            !documentSidebarVisible ||
                                            (documentSidebarVisible &&
                                              selectedMessageForDocDisplay ===
                                              message.messageId)
                                          ) {
                                            toggleDocumentSidebar();
                                          }

                                          setSelectedMessageForDocDisplay(
                                            message.messageId
                                          );
                                        }}
                                        currentPersona={liveAssistant}
                                        alternativeAssistant={
                                          currentAlternativeAssistant
                                        }
                                        messageId={message.messageId}
                                        content={message.message}
                                        files={message.files}
                                        query={
                                          messageHistory[i]?.query || undefined
                                        }
                                        citedDocuments={getCitedDocumentsFromMessage(
                                          message
                                        )}
                                        toolCall={message.toolCall}
                                        isComplete={
                                          i !== messageHistory.length - 1 ||
                                          (currentSessionChatState !=
                                            "streaming" &&
                                            currentSessionChatState !=
                                            "toolBuilding")
                                        }
                                        hasDocs={
                                          (message.documents &&
                                            message.documents.length > 0) ===
                                          true
                                        }
                                        handleFeedback={
                                          i === messageHistory.length - 1 &&
                                            currentSessionChatState != "input"
                                            ? undefined
                                            : (feedbackType) =>
                                              setCurrentFeedback([
                                                feedbackType,
                                                message.messageId as number,
                                              ])
                                        }
                                        handleSearchQueryEdit={
                                          i === messageHistory.length - 1 &&
                                            currentSessionChatState == "input"
                                            ? (newQuery) => {
                                              if (!previousMessage) {
                                                setPopup({
                                                  type: "error",
                                                  message:
                                                    "Cannot edit query of first message - please refresh the page and try again.",
                                                });
                                                return;
                                              }
                                              if (
                                                previousMessage.messageId ===
                                                null
                                              ) {
                                                setPopup({
                                                  type: "error",
                                                  message:
                                                    "Cannot edit query of a pending message - please wait a few seconds and try again.",
                                                });
                                                return;
                                              }
                                              onSubmit({
                                                messageIdToResend:
                                                  previousMessage.messageId,
                                                queryOverride: newQuery,
                                                alternativeAssistantOverride:
                                                  currentAlternativeAssistant,
                                              });
                                            }
                                            : undefined
                                        }
                                        handleForceSearch={() => {
                                          if (
                                            previousMessage &&
                                            previousMessage.messageId
                                          ) {
                                            createRegenerator({
                                              messageId: message.messageId,
                                              parentMessage: parentMessage!,
                                              forceSearch: true,
                                            })(llmManager.currentLlm);
                                          } else {
                                            setPopup({
                                              type: "error",
                                              message:
                                                "Failed to force search - please refresh the page and try again.",
                                            });
                                          }
                                        }}
                                        retrievalDisabled={
                                          currentAlternativeAssistant
                                            ? !personaIncludesRetrieval(
                                              currentAlternativeAssistant!
                                            )
                                            : !retrievalEnabled
                                        }
                                      />
                                    )}
                                  </div>
                                );
                              } else {
                                return (
                                  <div key={messageReactComponentKey}>
                                    <AIMessage
                                      setPresentingDocument={
                                        setPresentingDocument
                                      }
                                      currentPersona={liveAssistant}
                                      messageId={message.messageId}
                                      content={
                                        <ErrorBanner
                                          resubmit={handleResubmitLastMessage}
                                          error={message.message}
                                          showStackTrace={
                                            message.stackTrace
                                              ? () =>
                                                setStackTraceModalContent(
                                                  message.stackTrace!
                                                )
                                              : undefined
                                          }
                                        />
                                      }
                                    />
                                  </div>
                                );
                              }
                            })}

                            {(currentSessionChatState == "loading" ||
                              (loadingError &&
                                !currentSessionRegenerationState?.regenerating &&
                                messageHistory[messageHistory.length - 1]
                                  ?.type != "user")) && (
                                <HumanMessage
                                  setPresentingDocument={setPresentingDocument}
                                  key={-2}
                                  messageId={-1}
                                  content={submittedMessage}
                                />
                              )}

                            {currentSessionChatState == "loading" && (
                              <div
                                key={`${messageHistory.length}-${chatSessionIdRef.current}`}
                              >
                                <AIMessage
                                  setPresentingDocument={setPresentingDocument}
                                  key={-3}
                                  currentPersona={liveAssistant}
                                  alternativeAssistant={
                                    alternativeGeneratingAssistant ??
                                    alternativeAssistant
                                  }
                                  messageId={null}
                                  content={
                                    <div
                                      key={"Generating"}
                                      className="mr-auto relative inline-block"
                                    >
                                      <span className="text-sm loading-text">
                                        Thinking...
                                      </span>
                                    </div>
                                  }
                                />
                              </div>
                            )}

                            {loadingError && (
                              <div key={-1}>
                                <AIMessage
                                  setPresentingDocument={setPresentingDocument}
                                  currentPersona={liveAssistant}
                                  messageId={-1}
                                  content={
                                    <p className="text-red-700 text-sm my-auto">
                                      {loadingError}
                                    </p>
                                  }
                                />
                              </div>
                            )}
                            {messageHistory.length > 0 && (
                              <div
                                style={{
                                  height: !autoScrollEnabled
                                    ? getContainerHeight()
                                    : undefined,
                                }}
                              />
                            )}

                            {/* Some padding at the bottom so the search bar has space at the bottom to not cover the last message*/}
                            <div
                              ref={endPaddingRef}
                              className={
                                liveAssistant?.name === "Case Analysis"
                                  ? "h-[40px]" // or even h-[0px] if you want it tighter
                                  : "h-[95px]"
                              }
                            />

                            <div ref={endDivRef} />
                          </div>
                        </div>
                        <div
                          ref={inputRef}
                          className="absolute pointer-events-none bottom-0 z-10 w-full"
                        >
                          {aboveHorizon && messageHistory.length > 0 && (
                            <div className="mx-auto w-fit !pointer-events-none flex sticky justify-center">
                              <button
                                onClick={() => clientScrollToBottom()}
                                className="p-1 pointer-events-auto text-neutral-700 dark:text-neutral-800 rounded-2xl bg-neutral-200 border border-border  mx-auto "
                              >
                                <FiArrowDown size={18} />
                              </button>
                            </div>
                          )}

                          <div className="pointer-events-auto w-[95%] mx-auto relative mb-8">
                            <ChatInputBar
                              proSearchEnabled={proSearchEnabled}
                              setProSearchEnabled={() => toggleProSearch()}
                              toggleDocumentSidebar={toggleDocumentSidebar}
                              availableSources={sources}
                              availableDocumentSets={documentSets}
                              availableTags={tags}
                              filterManager={filterManager}
                              llmManager={llmManager}
                              removeDocs={() => {
                                clearSelectedDocuments();
                              }}
                              retrievalEnabled={retrievalEnabled}
                              toggleDocSelection={() =>
                                setToggleDocSelection(true)
                              }
                              showConfigureAPIKey={() =>
                                setShowApiKeyModal(true)
                              }
                              selectedDocuments={selectedDocuments}
                              message={message}
                              setMessage={setMessage}
                              stopGenerating={stopGenerating}
                              onSubmit={onSubmit}
                              chatState={currentSessionChatState}
                              alternativeAssistant={alternativeAssistant}
                              selectedAssistant={
                                selectedAssistant || liveAssistant
                              }
                              setAlternativeAssistant={setAlternativeAssistant}
                              setFiles={setCurrentMessageFiles}
                              handleFileUpload={handleImageUpload}
                              textAreaRef={textAreaRef}
                              setShowPopup={setShowPopup}
                            />

                            {selectedAssistant?.name === "Legacy Search" && showPopup && (
                              <div className="fixed inset-0 flex items-center justify-center z-50">
                                <div
                                  className="absolute inset-0 bg-opacity-50 backdrop-blur-sm"
                                  onClick={() => setShowPopup(false)}
                                />
                                <div className="relative bg-white backdrop-blur-lg rounded-2xl shadow-2xl p-8 w-3/5 max-h-[90vh] overflow-y-auto">
                                  <div className="flex justify-between items-start mb-4">
                                    <h3 className="text-2xl font-normal text-gray-900">Search Configuration</h3>
                                    <button
                                      onClick={() => setShowPopup(false)}
                                      className="text-gray-400 hover:text-gray-700 transition text-2xl leading-none ml-4"
                                      title="Close"
                                    >
                                      &times;
                                    </button>
                                  </div>

                                  <div className="mb-4 relative">
                                    <h3 className="font-normal text-gray-800">Select query to refine:</h3>
                                    <p className="text-gray-500 text-sm mb-3">Choose a query to apply keyword or advanced filters.</p>
                                    <div className="relative">
                                      <select
                                        value={selectedQueryId || ''}
                                        onChange={(e) => {
                                          setSelectedQueryId(e.target.value);
                                          setIsDropdownOpen(false); // Close dropdown after selection
                                        }}
                                        onClick={() => setIsDropdownOpen(true)} // Open on click
                                        onBlur={() => {
                                          setTimeout(() => setIsDropdownOpen(false), 150); // Close on blur with slight delay
                                        }}
                                        className="w-full p-2 pr-8 border border-gray-300 rounded-lg focus:outline-none appearance-none bg-white"
                                      >
                                        <option value="" disabled>Select a previous query</option>
                                        {searchHistory.map((q) => (
                                          <option key={q.id} value={q.id}>
                                            {q.query}
                                          </option>
                                        ))}
                                      </select>

                                      <div className="pointer-events-none absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600 text-lg">
                                        {isDropdownOpen ? <FiChevronUp /> : <FiChevronDown />}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Keyword Input */}
                                  <div className="mb-6">
                                    <h3 className="font-normal text-gray-800">Refine your search by keyword</h3>
                                    <p className="text-gray-500 text-sm">Add multiple legal keywords one by one (e.g., murder → evidence → arrest) to refine your search.</p>

                                    <div className="mt-4 flex items-center gap-4">
                                      <input
                                        className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 placeholder-gray-600 text-gray-900"
                                        placeholder="Enter a keyword"
                                        value={newKeyword}
                                        onChange={(e) => setNewKeyword(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            e.preventDefault(); // prevent form submission if inside a <form>
                                            addKeyword();
                                          }
                                        }}
                                      />
                                      <button onClick={addKeyword} title="Submit to proceed with refine search">
                                        <img src="/send.png" alt="add" className="h-8 w-8 cursor-pointer" />
                                      </button>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {keywords.map(item => (
                                        <div
                                          key={item}
                                          className="flex items-center px-3 py-1 text-sm text-gray-600 border border-gray-300 rounded-full bg-white group hover:bg-red-500 hover:text-white transition cursor-pointer"
                                          onClick={() => removeKeyword(item)}
                                        >
                                          <span>{item}</span>
                                          <IoMdClose className="ml-2 text-base opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Advanced Search Block */}
                                  <div className="border border-gray-300 rounded-lg p-4 mb-4">
                                    <button
                                      type="button"
                                      onClick={() => setShowAdvancedOption(prev => !prev)}
                                      className="w-full flex justify-between items-center text-left focus:outline-none"
                                    >
                                      <span className="font-medium text-gray-800">Advanced Search</span>
                                      <span className="text-gray-400">{showAdvancedOption ? '▲' : '▼'}</span>
                                    </button>

                                    {showAdvancedOption && (
                                      <p className="text-sm text-gray-500 mt-3">
                                        You can narrow down results by entering a judge&apos;s name, case title, or selecting a date range.
                                      </p>
                                    )}

                                    {!showAdvancedOption && (
                                      <div className="mt-2 text-xs text-gray-500 flex flex-row space-x-6">
                                        {judgeName && <span>Judge&apos;s Name: {judgeName}</span>}
                                        {state[0]?.startDate && state[0]?.endDate && (
                                          <span>
                                            Date Range: {state[0].startDate.toLocaleDateString()} {state[0].endDate.toLocaleDateString()}
                                          </span>
                                        )}
                                        {caseName && <span>Case Title: {caseName}</span>}
                                      </div>
                                    )}

                                    {showAdvancedOption && (
                                      <>
                                        <hr className="border-gray-300 my-4" />
                                        <div className="grid grid-cols-2 gap-8 mb-4">
                                          <div className="flex flex-col">
                                            <label className="text-sm font-medium text-gray-700 mb-1">Judge&apos;s Name:</label>
                                            <input
                                              type="text"
                                              value={judgeName}
                                              onChange={(e) => setJudgeName(e.target.value)}
                                              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 placeholder-gray-300 text-gray-700"
                                              placeholder="Enter judge's name"
                                            />
                                          </div>
                                          <div className="flex flex-col">
                                            <label className="text-sm font-medium text-gray-700 mb-1">Date:</label>
                                            <div className="flex items-center gap-4">
                                              <TooltipProvider>
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <input
                                                      type="text"
                                                      readOnly
                                                      value={
                                                        state[0]?.startDate && state[0]?.endDate
                                                          ? `${format(state[0].startDate, 'PPP')} - ${format(state[0].endDate, 'PPP')}`
                                                          : ''
                                                      }
                                                      className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 placeholder-gray-300 text-gray-700 cursor-not-allowed"
                                                      placeholder="Select date range"
                                                    />
                                                  </TooltipTrigger>
                                                  <TooltipContent
                                                    side="top"
                                                    className="text-sm font-medium text-white bg-gray-800 px-3 py-2 rounded shadow-lg"
                                                  >
                                                    You can&apos;t edit this manually. Use the calendar picker.
                                                  </TooltipContent>
                                                </Tooltip>
                                              </TooltipProvider>
                                              <button onClick={toggleDatePopup}>
                                                <img src="/Calendar.png" alt="select date" className="h-6" />
                                              </button>
                                              <TooltipProvider>
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <button
                                                      onClick={() => {
                                                        setState([{ startDate: new Date(), endDate: null, key: "selection" }]);
                                                        setJudgeName("");
                                                        setCaseName("");
                                                      }}
                                                      className="text-sm text-gray-500 underline"
                                                    >
                                                      Clear
                                                    </button>
                                                  </TooltipTrigger>
                                                </Tooltip>
                                              </TooltipProvider>

                                            </div>
                                          </div>
                                          <div className="col-span-2 flex flex-col">
                                            <label className="text-sm font-medium text-gray-700 mb-1">Case Title:</label>
                                            <input
                                              type="text"
                                              value={caseName}
                                              onChange={(e) => setCaseName(e.target.value)}
                                              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 placeholder-gray-300 text-gray-700"
                                              placeholder="Enter case title"
                                            />
                                          </div>
                                        </div>

                                        {showDatePopup && (
                                          <div className="fixed inset-0 flex items-center justify-center z-50 w-full">
                                            <div
                                              className="absolute inset-0 bg-white/70 backdrop-blur-sm"
                                              onClick={toggleDatePopup}
                                            />

                                            <div className="z-50">
                                              <LocalizationProvider dateAdapter={AdapterDateFns}>
                                                <Box className="bg-white p-6 rounded-2xl shadow-2xl border border-gray-200 min-w-[400px] max-w-[520px]">
                                                  <div className="flex justify-between items-start mb-4">
                                                    <div>
                                                      <h2 className="text-xl font-semibold text-gray-800 mb-1">Select Date Range</h2>
                                                      <p className="text-sm text-gray-500">Filter judgments within a custom date range.</p>
                                                    </div>
                                                    <button
                                                      onClick={() => setShowPopup(false)}
                                                      className="text-gray-400 hover:text-gray-700 transition text-2xl leading-none ml-4"
                                                      title="Close"
                                                    >
                                                      &times;
                                                    </button>
                                                  </div>

                                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                                    <DatePicker
                                                      label="Start Date"
                                                      value={state[0].startDate}
                                                      onChange={(date: Date | null) => {
                                                        setState([{ ...state[0], startDate: date }]);
                                                      }}
                                                      slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                                    />
                                                    <DatePicker
                                                      label="End Date"
                                                      value={state[0].endDate}
                                                      minDate={state[0].startDate || undefined}
                                                      onChange={(date: Date | null) => {
                                                        setState([{ ...state[0], endDate: date }]);
                                                      }}
                                                      slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                                    />
                                                  </div>

                                                  <div className="flex justify-between items-center">
                                                    <button
                                                      onClick={() => {
                                                        setState([{ startDate: null, endDate: null, key: "selection" }]);
                                                      }}
                                                      className="text-sm text-gray-500 hover:underline"
                                                    >
                                                      Clear
                                                    </button>

                                                    <button
                                                      onClick={() => setShowPopup(false)}
                                                      className="text-sm text-gray-500 hover:underline"
                                                    >
                                                      Cancel
                                                    </button>
                                                  </div>
                                                </Box>
                                              </LocalizationProvider>
                                            </div>
                                          </div>
                                        )}

                                      </>
                                    )}
                                  </div>

                                  <div title="Apply">
                                    <button
                                      onClick={applyConfiguration}
                                      className="bg-gray-900 text-white py-3 px-6 rounded-lg font-medium hover:bg-gray-800 transition"
                                    >
                                      Apply
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                            {enterpriseSettings &&
                              enterpriseSettings.custom_lower_disclaimer_content && (
                                <div className="mobile:hidden mt-4 flex items-center justify-center relative w-[95%] mx-auto">
                                  <div className="text-sm text-text-500 max-w-searchbar-max px-4 text-center">
                                    <MinimalMarkdown
                                      content={
                                        enterpriseSettings.custom_lower_disclaimer_content
                                      }
                                    />
                                  </div>
                                </div>
                              )}
                            {enterpriseSettings &&
                              enterpriseSettings.use_custom_logotype && (
                                <div className="hidden lg:block absolute right-0 bottom-0">
                                  <img
                                    src="/api/enterprise-settings/logotype"
                                    alt="logotype"
                                    style={{ objectFit: "contain" }}
                                    className="w-fit h-8"
                                  />
                                </div>
                              )}
                          </div>
                        </div>
                      </div>

                      <div
                        style={{ transition: "width 0.30s ease-out" }}
                        className={`
                          flex-none 
                          overflow-y-hidden 
                          transition-all 
                          bg-opacity-80
                          duration-300 
                          ease-in-out
                          h-full
                          ${documentSidebarVisible && !settings?.isMobile
                            ? "w-[350px]"
                            : "w-[0px]"
                          }
                      `}
                      />
                    </div>
                  )}
                </Dropzone>
              ) : (
                <div className="mx-auto h-full flex">
                  <div
                    style={{ transition: "width 0.30s ease-out" }}
                    className={`flex-none bg-transparent transition-all bg-opacity-80 duration-300 ease-in-out h-full
                        ${sidebarVisible && !settings?.isMobile
                        ? "w-[250px] "
                        : "w-[0px]"
                      }`}
                  />
                  <div className="my-auto">
                    <OnyxInitializingLoader />
                  </div>
                </div>
              )}
            </div>
          </div>
          <FixedLogo backgroundToggled={sidebarVisible || showHistorySidebar} />
        </div>
      </div>
    </>
  );
}