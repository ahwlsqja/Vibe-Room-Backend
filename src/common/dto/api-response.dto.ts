export class ApiResponse<T> {
  success!: boolean;
  data?: T;
  error?: {
    statusCode: number;
    message: string;
    timestamp: string;
    path: string;
  };

  static ok<T>(data: T): ApiResponse<T> {
    const response = new ApiResponse<T>();
    response.success = true;
    response.data = data;
    return response;
  }

  static fail(
    statusCode: number,
    message: string,
    path: string,
  ): ApiResponse<null> {
    const response = new ApiResponse<null>();
    response.success = false;
    response.error = {
      statusCode,
      message,
      timestamp: new Date().toISOString(),
      path,
    };
    return response;
  }
}
