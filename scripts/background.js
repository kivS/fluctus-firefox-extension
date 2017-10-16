console.log('Lift off!');


// Define config constant
const config = {
    SUPPORTED_PORTS: [8791,8238,8753],
    SUPPORTED_HOSTNAMES:[
        {
            'name': 'youtube',
            'alts': ['youtube', 'youtu.be']
        },
        {
            'name': 'vimeo',
            'alts': ['vimeo']
        },
        {
            'name': 'soundcloud',
            'alts': ['soundcloud']
        },
        {
            'name': 'twitch',
            'alts': ['twitch', 'go.twitch']
        },
    ],
    NATIVE_APP_INSTALL_URL: 'https://github.com/kivS/Fluctus/releases',
    STORAGE_KEY_NATIVE_APP_PORT : 'fd_native_app_port',
}

let NATIVE_APP_PORT = null;
const NO_SERVER_ERROR_NOTIF_ID = "fluctus_says_nope";



// get native app default port from storage if not get default one from config
browser.storage.sync.get(config.STORAGE_KEY_NATIVE_APP_PORT).then(result =>{
    // get port
    NATIVE_APP_PORT = result[config.STORAGE_KEY_NATIVE_APP_PORT];

    if(!NATIVE_APP_PORT){
        // Set last value of supported ports array as default
        NATIVE_APP_PORT = config.SUPPORTED_PORTS[config.SUPPORTED_PORTS.length-1];

        // Save to storage
        setNativeAppPortToStorage(NATIVE_APP_PORT);
    }

    console.log('Using default native port:', NATIVE_APP_PORT);
})



//*****************************************************
//               Events
//
//*****************************************************


// On install or upgrade
browser.runtime.onInstalled.addListener(() =>{

    // Show pageAction depending on current tab url
    browser.tabs.onUpdated.addListener((tab_id, change_info, tab) =>{
        // Only process when tab has completly loaded
        if(change_info.status == 'complete'){
            console.log('tab_id:', tab_id);
            console.log('Change info:', change_info);
            console.log('tab:', tab);

           
            let display_page_action = false;


           // check if current tab deserves the pageAction

           // YOUTUBE
           if(tab.url.match(/https:\/\/(?:www\.)?youtube\..+\/watch.*/)){
               display_page_action = true;

           }

           // Vimeo
           else if(tab.url.match(/https:\/\/(?:www\.)?vimeo\..+\/\d*/)){
               display_page_action = true;
           }

           // Soundcloud
           else if(tab.url.match(/https:\/\/(?:www\.)?soundcloud\..+\/.*/)){
               display_page_action = true;
           }

           // Twitch
           else if(tab.url.match(/https:\/\/go\.twitch\.tv\/[a-zA-Z0-9_]{4,25}$/)){
               display_page_action = true;
           }
           else if(tab.url.match(/https:\/\/go\.twitch\.tv\/videos\/\d+$/)){
               display_page_action = true;
           }


            if(display_page_action){
                // show pageAction
                browser.pageAction.show(tab_id);
                console.log('Displaying pageAction for:', tab.url);
            }

        }
    });



    // Add contextMenus
    browser.contextMenus.create({
        id: 'contextMenu_1',
        title: browser.i18n.getMessage("titleOnAction"),
        contexts: ['link', 'selection'],
  
    });


});




/**
 * On btn press lets: 
 * - stop the video, 
 * - get current video ellapsed time, 
 * - get the current url tab 
 * - make a openVideo request 
 */
browser.pageAction.onClicked.addListener( tab => {
    console.debug('page_action clicked..', tab);

    // pause current video
    
    browser.tabs.executeScript(null, {code: "if(document.getElementsByTagName('video').length >= 1) { document.getElementsByTagName('video')[0].pause() }"});

   

    // get current video time
    new Promise((resolve) => {
        
        browser.tabs.executeScript(null, {code: "if(document.getElementsByTagName('video').length >= 1) { document.getElementsByTagName('video')[0].currentTime }"}, result =>{
           resolve(parseInt(result[0]));
        }); 

     

    }).then(currentTime =>{
            console.debug('current video time: ', currentTime);

            if(NATIVE_APP_PORT){
                // Send POST request to open video with current video time
                openVideoRequest(tab.url, currentTime);

            }else{
                // PING NATIVE APP
                pingNativeAppServer(tab.url, currentTime);

            }

    })

});



/**
 * On text selected/ or item and mouse right-click(context menu) lets:
 * - get linkUrl in case item is a link or get the selected text
 * -  
 */
browser.contextMenus.onClicked.addListener((object_info, tab) =>{
    console.debug('Context Menu cliked: ', object_info);

    // parser for url
    let parser = parseUrl(object_info.linkUrl || object_info.selectionText);

    try{
        // get 'cleaned' url & hostname to avoid multiple getMediaProvider calls
        let [hostname, cleaned_url] = getCleanedUrl(parser.href);
        

        if(cleaned_url){

            // Open video request
            openVideoRequest(cleaned_url, null, hostname);
        }

    }catch(e){
        console.log('url not supported.');
    }

});


/**
 * Handle notifications click event
 */
browser.notifications.onClicked.addListener(notif =>{
    console.log('notification clicked:', notif);

    switch (notif) {
        case NO_SERVER_ERROR_NOTIF_ID:
            browser.tabs.create({ url: config.NATIVE_APP_INSTALL_URL });
            break;        
    }

    // clear notification
    browser.notifications.clear(notif);
})


browser.notifications.onShown.addListener(notif =>{

    // for no server error the user should have time!
    if(notif == NO_SERVER_ERROR_NOTIF_ID) return;

    // automatically clear notification after 2.5 seconds
    const autoClearTimeOut = setTimeout(() =>{
        browser.notifications.clear(notif);
        clearTimeout(autoClearTimeOut);
    }, 2500)
    
});




//*****************************************************
//               Native app functions
//
//*****************************************************


/**
 * Send request to native app to open video panel
 * @param  {[string]} url
 * @param  {[integer]} currentTime(optional)
 * @param  {[string]} hostname (optional) - from contextMenu
 */
function openVideoRequest(url, currentTime, hostname=null){

    let media_provider;

    // if request comes from contextMenu avoid multiple calls to getMediaProvider by passing explicit media_provider
    if(hostname){
        media_provider = hostname;
    
    }else{
        // get media provider(hostname) like youtube, vimeo
        [media_provider] = getMediaProvider(url);
    }


    if(!media_provider){
        alertUser("", browser.i18n.getMessage('mediaProviderNotSupportedError'));
        return;
    }

    // get payload for start_player request
    const payload = getPayload(media_provider, url, currentTime);
    console.log('Payload to send: ', payload);

    // make sure payload has at least player_type and one more arg like the url of the request
    if(Object.keys(payload).length <= 1){
        alertUser("", browser.i18n.getMessage('urlNotSupportedError'));
        return;
    }

    // Make request
    fetch(`http://localhost:${NATIVE_APP_PORT}/start_player`,{
        method: 'POST',
        headers: new Headers({"Content-Type": "application/json"}),
        body: JSON.stringify(payload)
    })
    .then(response =>{
        return response.json()
    })
    .then(response_data => {

        console.info('Video start request sent!');

        if(response_data.status != "ok"){
            alertUser("", response_data.status);    
        }    
        
    })
    .catch(err => {
        console.error('Failed to send request to native app: ', err);

        // If request fails let's reset default native app port, that way we'll have to ping for new port
        NATIVE_APP_PORT = null;
        setNativeAppPortToStorage("");

        // Ping server again
        console.log('Trying to connect again...');
        pingNativeAppServer(url, currentTime);

    });

}


/**
 * Pings app server, selects proper port & resumes previous requests
 * @param requested_video_url  
 * @param requested_video_time 
 */
function pingNativeAppServer(requested_video_url, requested_video_time){
    // make sure we start by the first port defined in config
    let ping_urls = config.SUPPORTED_PORTS.reverse().map(port =>{
        return [`http://localhost:${port}/ping`, port];
    })

    // return single promise from array of promises looking for the companion app
    Promise.all(ping_urls.map(ping_url => {

        return new Promise((resolve, reject) =>{

            fetch( ping_url[0].toString() )
                .then(response =>{
                    if(response.ok){
                        // if port is found lets skip all other promises by rejecting 'father promise'
                        reject(ping_url[1]);
                    }
                })
                .catch(error =>{
                    console.warn(`No one behind port ${ping_url[1]}!`);
                    resolve('nope');
                })
        })
        

    }))
    .then(responses =>{
        console.log('Companion app not found!');

        // No server found
        alertUser(NO_SERVER_ERROR_NOTIF_ID, chrome.i18n.getMessage("noServerError"));
        
    })
    .catch(port =>{
        console.debug('Companion app found behind port:', port);
        // Cache server port
        NATIVE_APP_PORT = port;
        setNativeAppPortToStorage(port);

        // Send POST request to open video
        openVideoRequest(requested_video_url ,requested_video_time);
    });
}










//*****************************************************
//               Helpler Functions
//
//*****************************************************



/**
 * Given an url lets:
 * - go over our supported hosts(eg: youtube, soundcloud)
 * - if url matches supported host.alt lets return host name
 * 
 * @param  url
 * @return [host name, full matched url] or null
 */
function getMediaProvider(url){
    console.debug('Get video type of: ', url);

    let result = null;

    // Go over supported hostnames
    config.SUPPORTED_HOSTNAMES.forEach(host =>{

        host.alts.forEach(alt =>{
            // build reg rexp to match host in url
            let match_exp = RegExp(`(?:https:\\/\\/)?(?:www\\.)?${alt}(?:.+)?`,'g');
            
            console.debug('Match RegExp: ', match_exp);

            // execute it
            let matched_val = url.match(match_exp);
            console.debug('Match result: ', matched_val);

            if(matched_val) result = [host.name, matched_val[0]];

        })

    });

    return result;
}



/**
 * Given a media provider like youtube or soundcloud, a url & maybe the video's ellapsed time lets:
 * - build & return payload object 
 * 
 * @param media_provider 
 * @param  url            
 * @param  currentTime   
 */
function getPayload(media_provider, url, currentTime){

    let payload = {};

    // default - player_type 
    payload['player_type'] = media_provider;

    switch (media_provider) {

        case "youtube":
    
            //  if url is 'short-url' lets replace it with full url
            payload['video_url'] = url.replace('youtu.be/', 'www.youtube.com/watch?v=');
            // video time
            if(currentTime) payload['video_currentTime'] = currentTime;

        break;


        case "vimeo":
            // video url
            payload['video_urkl'] = url;
            // video time
            if(currentTime) payload['time'] = currentTime;
        break;

        case "soundcloud":
            // url
            payload['url'] = url;
        break;

        case "twitch":
            // get player channel
            let channel_regexp_match = url.match(RegExp('https://go.twitch.tv/([a-zA-Z0-9_]{4,25}$)'));
            console.log('Channel match regexp:', channel_regexp_match);
            if(channel_regexp_match) payload['channel_id'] = channel_regexp_match[1];

            // get video id
            let video_regexp_match = url.match(RegExp('https://go.twitch.tv/videos/(\\d+$)'));
            console.log('video match regexp:', video_regexp_match);
            if(video_regexp_match) payload['video_id'] = `v${video_regexp_match[1]}`;

        break;
        
    }

    return payload;
}


/**
 * Given an url or a text with links, return if supported, the valid url & hostname
 *
 * @param  url_candidate
 * @return clean_url_candidate, hostname or error msg
 */
function getCleanedUrl(url_candidate){
    
    // url object
    let url_candidate_obj = parseUrl(url_candidate);
    console.debug('candidate url :', url_candidate_obj);

    const media_provider = getMediaProvider(url_candidate_obj.hostname);

    if(media_provider){
        console.log(`Hostname: ${url_candidate_obj.hostname} is supported!`);
        // If candidate url is already supported lets return it
        const [hostname] = media_provider;
        return [hostname, url_candidate];

    }else{
        console.log(`Hostname: ${url_candidate_obj.hostname} is not supported.. let\s try to retrieve clean url from it`);

        try{

            const [hostname , clean_url_candidate] = getMediaProvider(url_candidate_obj.search);

            if(!clean_url_candidate) throw `No match for dirty url: ${url_candidate_obj.search}`;

            // clean url is supported
            return [hostname, clean_url_candidate];

        }catch(e){
            alertUser("", browser.i18n.getMessage("urlNotSupportedError"));
        }
    }

}



/**
 * Save native_app_port to storage
 * @param  {[string]} port
 */
function setNativeAppPortToStorage(port){
    const objToStore = {};

    objToStore[config.STORAGE_KEY_NATIVE_APP_PORT] = port;

    browser.storage.sync.set(objToStore);

}


/**
 * Parses url and returns object with url's various components
 * @param  {[string]} url
 * @return {[object]}     -> Url object
 */
function parseUrl(url){
    let parser = document.createElement('a');
    parser.href = decodeURIComponent(url);

    return parser;
}


/**
 * Send notification to the user
 * @param  notification_id 
 * @param  message        
 */
function alertUser(notification_id, message){
    browser.notifications.create(notification_id, {
       "type": "basic",
       "iconUrl": browser.extension.getURL("icons/icon-64.png"),
       "title": "Fluctus",
       "message": message
    });
}

