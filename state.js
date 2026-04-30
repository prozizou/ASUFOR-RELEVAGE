export const state = {
    currentAgentId: null,
    activeQueryRef: null,
    activeCallback: null,
    clientsCache: [],
    filteredClientsCache: [],
    currentFilter: 'all',
    displayedCount: 0,
    observer: null,
    isLoadingMore: false,
    currentClientIndex: 0,
    
    currentPhotoKey: null,
    cameraStream: null,
    currentPhotoBlob: null,
    tesseractLoaded: false,
    
    mediaRecorder: null,
    audioChunks: [],
    audioBlob: null,
    
    deferredPrompt: null,
    pwaBanner: null,
    networkStatusDebounce: null
};
