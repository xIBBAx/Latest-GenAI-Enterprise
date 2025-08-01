"use client";

import React, { createContext, useContext, useState } from "react";
import { NewTeamModal } from "../modals/NewTeamModal";
import NewTenantModal from "../modals/NewTenantModal";
import { User, NewTenantInfo } from "@/lib/types";
import { NEXT_PUBLIC_CLOUD_ENABLED } from "@/lib/constants";

type ModalContextType = {
  showNewTeamModal: boolean;
  setShowNewTeamModal: (show: boolean) => void;
  newTenantInfo: NewTenantInfo | null;
  setNewTenantInfo: (info: NewTenantInfo | null) => void;
  invitationInfo: NewTenantInfo | null;
  setInvitationInfo: (info: NewTenantInfo | null) => void;
};

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const useModalContext = () => {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error("useModalContext must be used within a ModalProvider");
  }
  return context;
};

export const ModalProvider: React.FC<{
  children: React.ReactNode;
  user: User | null;
}> = ({ children, user }) => {
  const [showNewTeamModal, setShowNewTeamModal] = useState(false);
  const [newTenantInfo, setNewTenantInfo] = useState<NewTenantInfo | null>(
    user?.tenant_info?.new_tenant || null
  );
  const [invitationInfo, setInvitationInfo] = useState<NewTenantInfo | null>(
    user?.tenant_info?.invitation || null
  );

  // Initialize modal states based on user info
  React.useEffect(() => {
    if (user?.tenant_info?.new_tenant) {
      setNewTenantInfo(user.tenant_info.new_tenant);
    }
    if (user?.tenant_info?.invitation) {
      setInvitationInfo(user.tenant_info.invitation);
    }
  }, [user?.tenant_info]);

  // Render all application-wide modals
  const renderModals = () => {
    if (!user || !NEXT_PUBLIC_CLOUD_ENABLED) return null;

    return (
      <>
        {/* Modal for users to request to join an existing team */}
        <NewTeamModal />

        {/* Modal for users who've been accepted to a new team */}
        {newTenantInfo && (
          <NewTenantModal
            tenantInfo={newTenantInfo}
            // Close function to clear the modal state
            onClose={() => setNewTenantInfo(null)}
          />
        )}

        {/* Modal for users who've been invited to join a team */}
        {invitationInfo && (
          <NewTenantModal
            isInvite={true}
            tenantInfo={invitationInfo}
            // Close function to clear the modal state
            onClose={() => setInvitationInfo(null)}
          />
        )}
      </>
    );
  };

  return (
    <ModalContext.Provider
      value={{
        showNewTeamModal,
        setShowNewTeamModal,
        newTenantInfo,
        setNewTenantInfo,
        invitationInfo,
        setInvitationInfo,
      }}
    >
      {children}
      {renderModals()}
    </ModalContext.Provider>
  );
};
