export interface MemoryConfig {
  coreFile: string;
  topicDir: string;
  maxCoreLines: number;
  maxTopicFilesPerQuery: number;
}

export interface TopicMatch {
  filename: string;
  score: number;
  content: string;
}
