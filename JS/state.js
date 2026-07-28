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

    currentPhotoKey: null,
    currentPhotoMode: 'index',
    cameraStream: null,
    currentPhotoBlob: null,
    currentPhotoObjectUrl: null,
    tesseractLoaded: false,
    
    mediaRecorder: null,
    audioChunks: [],
    audioBlob: null,
    
    deferredPrompt: null,
    pwaBanner: null,
    networkStatusDebounce: null
};
