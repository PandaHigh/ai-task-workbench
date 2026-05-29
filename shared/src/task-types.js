export function hasPermission(perm, action) {
    if (!perm)
        return false;
    switch (action) {
        case "addTask": return perm.canAddTask;
        case "approveTask": return perm.canApproveTask;
        case "editQueue": return perm.canEditQueue;
        case "startStop": return perm.canStartStop;
        case "manageShare": return perm.canManageShare;
    }
}
export function roleToPermissions(role) {
    switch (role) {
        case "owner":
            return { role: "owner", canAddTask: true, canApproveTask: true, canEditQueue: true, canStartStop: true, canManageShare: true };
        case "collaborator":
            return { role: "collaborator", canAddTask: true, canApproveTask: true, canEditQueue: true, canStartStop: false, canManageShare: false };
        case "viewer":
            return { role: "viewer", canAddTask: false, canApproveTask: false, canEditQueue: false, canStartStop: false, canManageShare: false };
    }
}
//# sourceMappingURL=task-types.js.map