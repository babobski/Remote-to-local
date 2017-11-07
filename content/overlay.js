/**
 * Namespaces
 */

if (typeof(extensions) === 'undefined') extensions = {};
if (typeof(extensions.remoteToLocal) === 'undefined') extensions.remoteToLocal = { version : '1.0.0' };
(function() {
	const { classes: Cc, interfaces: Ci } = Components;
	
	var notify = require("notify/notify"),
		self = this;
	
	this.saveToLocalFile = function(){
		var currentView = ko.views.manager.currentView,
			currentProject = ko.projects.manager.currentProject,
			patIO = require("sdk/fs/path");
		
		if (currentView === null || currentProject === null) {
			return false;
		}
		
		var koDoc = currentView.koDoc,
			curFile = koDoc.file;
		
		if (curFile === null) {
			return false;
		}
		
		if (curFile.isRemoteFile) {
			var projectLiveD = currentProject.liveDirectory,
				projectUrl = currentProject.url,
				projectPath = patIO.dirname(projectUrl),
				displayPath = curFile.displayPath;
				
			//// Skip if file is not in current project
			if (displayPath.indexOf(projectLiveD) == -1) {
				return false;
			}
			var localMirrorUrl = projectPath + displayPath.substr(projectLiveD.length, displayPath.length),
				parseddUrl = ko.uriparse.displayPath(localMirrorUrl);
			
			try {
				self.createFileIfNotExist(parseddUrl);
				self.saveFile(parseddUrl, koDoc.buffer.replace(/\r/g, ''));
			} catch(e) {
				console.error(e);
			}
			
			// TODO make dynamic
			if (koDoc.language === 'Less') {
				var parsedDir = patIO.dirname(displayPath);
				if (parsedDir.substr((parsedDir.length - 4), parsedDir.length) == 'less') {
					var defaultUrl = parsedDir.substr(0, (parsedDir.length - 4)) + 'default.css',
						fileContent = self.readFile(defaultUrl);
					
					if (fileContent !== false) {
						var localDefaultUrl = projectPath + defaultUrl.substr(projectLiveD.length, defaultUrl.length);
						
						try {
							self.saveFile(localDefaultUrl, fileContent.replace(/\r/g, ''));
						} catch(e) {
							console.error(e);
						}
					}
				}
			}
		}
	};
	
	this.syncFolderWithFileZilla = function(){
		var pathFileZilla = 'C:/Program Files/FileZilla FTP Client/filezilla.exe';
		var RCS = Cc["@activestate.com/koRemoteConnectionService;1"].getService(Ci.koIRemoteConnectionService);
		var item = ko.places.manager.getSelectedItem();
		var file = item.file;
		var currentProject = ko.projects.manager.currentProject,
			patIO = require("sdk/fs/path");
			
		
		if (file === undefined) {
			return false;
		}
		
		if (currentProject === null) {
			return false;
		}
		
		if (file.isRemoteFile) {
			var serverInfo = RCS.getConnectionUsingUri(file.URI);
			var serverPath = item.type === 'file'? file.dirName : (file.dirName + '/' + file.baseName);
			var projectLiveD = currentProject.liveDirectory,
			projectUrl = currentProject.url,
			projectPath = patIO.dirname(projectUrl),
			displayPath = file.displayPath;
			
			if (displayPath.indexOf(projectLiveD) == -1) {
				return false;
			}
			var localMirrorUrl = projectPath + displayPath.substr(projectLiveD.length, displayPath.length),
				parseddUrl = item.type === 'file' ? ko.uriparse.displayPath(patIO.dirname(localMirrorUrl)) : ko.uriparse.displayPath(localMirrorUrl);
			
			
			ko.run.output.kill();
			ko.run.command('"' + pathFileZilla + '" ' + serverInfo.username +':"\"'+ serverInfo.password +'"\"@'+serverInfo.server+':'+serverInfo.port + serverPath + ' --local="' + parseddUrl + '"', { 
				"runIn": 'command-output-window', //'no-console',
				"openOutputWindow": true,	
			});
		}
		
		
	};
	
	this.createFileIfNotExist = function($url) {
		var koFile = require("ko/file"),
			patIO = require("sdk/fs/path");
		if (!koFile.exists($url)) {
			var path = patIO.dirname($url);
			var fileName = patIO.basename($url);
			
			koFile.mkpath(path);
			koFile.create(path, fileName);  
		}
		return;
	};
	
	this.saveFile = function(filepath, filecontent) {
	
		var file = Components
			.classes["@activestate.com/koFileEx;1"]
			.createInstance(Components.interfaces.koIFileEx);
		file.path = filepath;
	
		file.open('w');
	
		file.puts(filecontent);
		file.close(); 
	
		return;
	};
	
	this.readFile = function(filepath) {
	
		var reader = Components.classes["@activestate.com/koFileEx;1"]
			.createInstance(Components.interfaces.koIFileEx),
			placeholder;
	
		reader.path = filepath;
	
		try {
			reader.open("r");
			placeholder = reader.readfile();
			reader.close();
	
			return placeholder;
	
		} catch (e) {
			notify.send('ERROR: Reading file: ' + filepath, 'tools');
		}
	
		return false;
	};
	
	this.openSettings = function() {
		var features = "chrome,titlebar,toolbar,centerscreen";
		window.openDialog('chrome://remoteToLocal/content/pref-overlay.xul', "remoteToLocalSettings", features);
	};
	
	window.addEventListener('file_saved', self.saveToLocalFile);
	

}).apply(extensions.remoteToLocal);
